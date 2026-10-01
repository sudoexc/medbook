/**
 * Call-outcome semantics (TZ-risk-outcomes §4), used by
 * `POST /api/crm/action-center/risk-today/outcome`, which stamps every
 * Action of one risk-today appointment, creating a NO_CONTACT_CALL row when
 * the appointment surfaced without any (audit AC-04), and by the move saved
 * from the risk list (`recordRescheduleOutcome`). The per-Action endpoint
 * that shared them is retired (audit AC-19).
 *
 *   CONFIRMED     → confirmAppointment(via INBOUND_CALL) + Action DONE(outcome)
 *   RESCHEDULED   → refused by the endpoint (audit AC-10): written with the
 *                   same DONE stamp by a move saved from the risk list, once
 *                   the new time is committed (`recordRescheduleOutcome` in
 *                   `risk-outcome.ts`)
 *   CALLBACK      → before the visit: Action SNOOZED until callbackAt (+ note),
 *                   the row resurfaces then. At or after the visit time: the
 *                   call is handed to a PATIENT_CALLBACK task (see below)
 *   RETURN_LATER  → cancelAppointment (the patient will not come today) +
 *                   Action DONE(outcome) + a PATIENT_CALLBACK task for 09:00
 *                   of the return day
 *   REFUSED       → cancelAppointment(reason=note) + Action DONE(outcome)
 *   NO_ANSWER     → callAttempts++, SNOOZED a short while; escalate at the cap
 *
 * Why the hand-off (audit AC-09): the risk rows of a visit die with it.
 * NO_SHOW_RISK_HIGH expires at the visit time, NO_CONTACT_CALL at the end of
 * its clinic day, UNCONFIRMED_24H stops being detected once the visit is past,
 * and the risk-today list shows today's visits only. A snooze past that point
 * was swept as EXPIRED before it ran out: «Перезвонить завтра в 11:00» and
 * «Хочет прийти 10 октября» never came back, and the untouched visit turned
 * into a NO_SHOW on the patient's record. A promise that outlives the visit
 * now lives in its own row, which surfaces at the promised time and stays
 * until a person closes it.
 */
import type { Prisma } from "@/generated/prisma/client";

import { confirmAppointment } from "@/server/appointments/confirm";
import { cancelAppointment } from "@/server/appointments/cancel";
import type { PatientCallbackPayload } from "@/lib/actions/types";
import type { TenantScopedPrisma } from "@/lib/prisma";
import type { ActionOutcome } from "@/server/schemas/action";

import { clinicDateKey, clinicMorningOf } from "./clinic-day";
import { surfaceMoment, upsertAction } from "./repository";

/** How long a «не дозвонился» row hides before it resurfaces, and the attempt
 *  cap after which it escalates to a louder severity. */
export const NO_ANSWER_SNOOZE_MIN = 120;
export const NO_ANSWER_MAX_ATTEMPTS = 3;

export type OutcomeInput = {
  outcome: ActionOutcome;
  /** Trimmed free text, null when empty. */
  note: string | null;
  callbackAt: Date | null;
};

/**
 * The input as it is recorded. «Хочет прийти позже» picks a day, not a time:
 * the call is due at the start of that clinic day (09:00), whatever instant
 * the date picker produced (UTC midnight is 05:00 in Tashkent).
 */
export function normalizeOutcomeInput(input: OutcomeInput): OutcomeInput {
  if (input.outcome === "RETURN_LATER" && input.callbackAt) {
    return { ...input, callbackAt: clinicMorningOf(input.callbackAt) };
  }
  return input;
}

/**
 * True for the outcome only a saved move may write: «Перенести» (audit AC-10).
 * Recorded as a call outcome it closed the visit's risk rows before any date
 * was moved, and a drawer closed without saving left a visit «перенесён»
 * that was still at 15:00 and out of every list. The endpoints refuse it; the
 * appointment PATCH writes it after a move saved in the drawer the risk-today
 * row opened.
 */
export function outcomeRecordedByTheMove(outcome: ActionOutcome): boolean {
  return outcome === "RESCHEDULED";
}

/**
 * «Хочет прийти позже» means another day: it cancels the visit, so a return
 * day on or before the visit's own clinic day is a mistake (a later time
 * today is «Перезвонить позже» or «Перенести»). Checked before any write.
 */
export function returnDayIsLater(input: OutcomeInput, appointmentAt: Date): boolean {
  if (input.outcome !== "RETURN_LATER" || !input.callbackAt) return true;
  return clinicDateKey(input.callbackAt) > clinicDateKey(appointmentAt);
}

/**
 * True when the call this outcome promises can no longer ride on the visit's
 * own risk rows and moves to a PATIENT_CALLBACK task (see the header): always
 * for «Хочет прийти позже», and for «Перезвонить позже» set at or after the
 * visit time.
 */
export function callbackOutlivesVisit(
  input: OutcomeInput,
  appointmentAt: Date,
): boolean {
  if (input.outcome === "RETURN_LATER") return input.callbackAt != null;
  if (input.outcome === "CALLBACK") {
    return (
      input.callbackAt != null &&
      input.callbackAt.getTime() >= appointmentAt.getTime()
    );
  }
  return false;
}

/**
 * The Action columns an outcome writes. `before` supplies the attempt counter
 * and severity the NO_ANSWER escalation reads. `handedOff`: the promised call
 * moved to a PATIENT_CALLBACK task (`callbackOutlivesVisit`), so this row is
 * done; its outcome and callback time stay on it for «Обработано сегодня».
 */
export function outcomeStamp(
  before: { callAttempts: number; severity: string },
  input: OutcomeInput,
  actorId: string,
  now: Date,
  opts: { handedOff?: boolean } = {},
): Prisma.ActionUncheckedUpdateInput {
  const stamp: Prisma.ActionUncheckedUpdateInput = {
    outcome: input.outcome,
    outcomeNote: input.note,
    callbackAt: input.callbackAt,
    resolvedById: actorId,
  };
  switch (input.outcome) {
    case "CONFIRMED":
    case "REFUSED":
    case "RESCHEDULED":
      stamp.status = "DONE";
      stamp.doneAt = now;
      break;
    case "CALLBACK":
    case "RETURN_LATER":
      if (opts.handedOff) {
        stamp.status = "DONE";
        stamp.doneAt = now;
        break;
      }
      // Snooze survives the engine recompute — the row resurfaces exactly at
      // callbackAt with the note attached ("перезвонить" / "хотел вернуться").
      stamp.status = "SNOOZED";
      stamp.snoozeUntil = input.callbackAt;
      break;
    case "NO_ANSWER": {
      const attempts = before.callAttempts + 1;
      stamp.callAttempts = attempts;
      stamp.status = "SNOOZED";
      stamp.snoozeUntil = new Date(
        now.getTime() + NO_ANSWER_SNOOZE_MIN * 60_000,
      );
      if (attempts >= NO_ANSWER_MAX_ATTEMPTS && before.severity !== "critical") {
        stamp.severity = "high";
      }
      break;
    }
  }
  // A snoozing outcome brings the task back later: it returns at the top of
  // its severity, not at the position of its original insert.
  if (stamp.status === "SNOOZED") {
    stamp.surfacedAt = surfaceMoment(now, stamp.snoozeUntil as Date | null);
  }
  return stamp;
}

export type OutcomeDomainResult =
  | Awaited<ReturnType<typeof confirmAppointment>>
  | Awaited<ReturnType<typeof cancelAppointment>>
  | null;

/**
 * The appointment side of an outcome: CONFIRMED confirms, REFUSED cancels
 * with the patient's reason, RETURN_LATER cancels too, since the patient
 * said they will come another day: left BOOKED, the slot stayed taken and
 * the visit became a NO_SHOW on the patient's record (audit AC-09). Every
 * other outcome leaves the appointment as is (RESCHEDULED is carried out in
 * the appointment dialog).
 */
export async function applyOutcomeToAppointment(params: {
  outcome: ActionOutcome;
  appointmentId: string;
  clinicId: string;
  actorId: string;
  note: string | null;
}): Promise<OutcomeDomainResult> {
  switch (params.outcome) {
    case "CONFIRMED":
      return confirmAppointment({
        appointmentId: params.appointmentId,
        clinicId: params.clinicId,
        actorId: params.actorId,
        via: "INBOUND_CALL",
      });
    // Both are the patient's decision, carried out by reception: the
    // patient is told «вы отменили запись», not the clinic's apology
    // (audit AC-19).
    case "REFUSED":
      return cancelAppointment({
        appointmentId: params.appointmentId,
        clinicId: params.clinicId,
        actorId: params.actorId,
        reason: params.note ?? "patient:refused-on-call",
        patientInitiated: true,
      });
    case "RETURN_LATER":
      return cancelAppointment({
        appointmentId: params.appointmentId,
        clinicId: params.clinicId,
        actorId: params.actorId,
        // Same code the Mini App uses for «хочу перенести».
        reason: params.note ?? "patient:wants-reschedule",
        patientInitiated: true,
      });
    default:
      return null;
  }
}

/**
 * Create (or re-time) the PATIENT_CALLBACK task that carries a promised call
 * past the visit (audit AC-09). Hidden until `callbackAt`, then in every work
 * list; no `expiresAt`, so neither the sweep nor time closes it. One per
 * visit: a second outcome on the same visit moves the same task.
 */
export async function scheduleCallbackTask(
  prisma: TenantScopedPrisma,
  params: {
    clinicId: string;
    appointment: {
      id: string;
      date: Date;
      patientId: string;
      patientName: string;
      doctorName: string;
    };
    input: OutcomeInput;
  },
): Promise<{ id: string }> {
  const { appointment, input } = params;
  const callbackAt = input.callbackAt!;
  const payload: PatientCallbackPayload = {
    type: "PATIENT_CALLBACK",
    appointmentId: appointment.id,
    patientId: appointment.patientId,
    patientName: appointment.patientName,
    doctorName: appointment.doctorName,
    appointmentAt: appointment.date.toISOString(),
    reason: input.outcome === "RETURN_LATER" ? "RETURN_LATER" : "CALLBACK",
    callbackAt: callbackAt.toISOString(),
    note: input.note ?? "",
  };
  const res = await upsertAction(prisma, params.clinicId, payload, {
    deeplinkPath: `/crm/patients/${appointment.patientId}`,
    surfaceAt: callbackAt,
    expiresAt: null,
  });
  return { id: res.id };
}

/**
 * True when the outcome proves somebody actually spoke to the patient, i.e.
 * it may advance `Patient.lastContactedAt`. «Не дозвонился» is the one call
 * that reached nobody: stamping it marked the patient «на связи» and hid the
 * risk row for two weeks (audit AC-04).
 */
export function outcomeReachedPatient(outcome: ActionOutcome): boolean {
  return outcome !== "NO_ANSWER";
}
