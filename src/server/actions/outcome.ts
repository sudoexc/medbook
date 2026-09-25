/**
 * Call-outcome semantics shared by the two outcome endpoints
 * (TZ-risk-outcomes §4):
 *
 *   - `POST /api/crm/actions/[id]/outcome` stamps one Action;
 *   - `POST /api/crm/action-center/risk-today/outcome` stamps every Action
 *     of one risk-today appointment, creating a NO_CONTACT_CALL row when the
 *     appointment surfaced without any (audit AC-04).
 *
 * Both must write the same status / snooze / attempt stamps and drive the
 * same appointment side effect, so the rules live here once.
 *
 *   CONFIRMED     → confirmAppointment(via INBOUND_CALL) + Action DONE(outcome)
 *   RESCHEDULED   → Action DONE(outcome)  (the reschedule itself happens in the
 *                   dialog; this just records + closes the row)
 *   CALLBACK      → Action SNOOZED until callbackAt (+ note) — resurfaces then
 *   RETURN_LATER  → Action SNOOZED until the return date (+ note)
 *   REFUSED       → cancelAppointment(reason=note) + Action DONE(outcome)
 *   NO_ANSWER     → callAttempts++, SNOOZED a short while; escalate at the cap
 */
import type { Prisma } from "@/generated/prisma/client";

import { confirmAppointment } from "@/server/appointments/confirm";
import { cancelAppointment } from "@/server/appointments/cancel";
import type { ActionOutcome } from "@/server/schemas/action";

import { surfaceMoment } from "./repository";

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
 * The Action columns an outcome writes. `before` supplies the attempt counter
 * and severity the NO_ANSWER escalation reads.
 */
export function outcomeStamp(
  before: { callAttempts: number; severity: string },
  input: OutcomeInput,
  actorId: string,
  now: Date,
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
 * with the patient's reason. Every other outcome leaves the appointment as is
 * (RESCHEDULED is carried out in the appointment dialog).
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
    case "REFUSED":
      return cancelAppointment({
        appointmentId: params.appointmentId,
        clinicId: params.clinicId,
        actorId: params.actorId,
        reason: params.note ?? "patient:refused-on-call",
      });
    default:
      return null;
  }
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
