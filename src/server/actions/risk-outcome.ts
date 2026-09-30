/**
 * Record a risk-today call outcome for one APPOINTMENT (audit AC-04).
 *
 * A risk-today row stands for an appointment, not for an Action: it may carry
 * NO_SHOW_RISK_HIGH and UNCONFIRMED_24H rows, or none at all when the patient
 * surfaced only because they have not been in touch for two weeks. The old
 * client looped over the row's Action ids, so a «не на связи»-only row sent
 * nothing to the server: «Отказался» left the visit BOOKED, «Подтвердил»
 * confirmed nothing, and every outcome (even «Не дозвонился») stamped the
 * patient as contacted.
 *
 * Here the server resolves the row itself:
 *   0. the appointment must be one the risk-today list can show: today's
 *      clinic day, still ahead, patient not yet arrived. Anything else is
 *      refused before a single write, because the endpoint takes a bare
 *      appointment id: it must not become a way to cancel next week's visit,
 *      or to open a call task and mark «на связи» for an arbitrary card. A
 *      patient who has arrived meanwhile gets its own answer
 *      (`patient_in_clinic`), so reception reads «он уже в клинике» rather
 *      than «запись закрыта». «Хочет прийти позже» must name a later day;
 *   1. the appointment side effect runs once (confirm / cancel), before any
 *      Action is written, so a refused side effect leaves nothing behind;
 *   2. the outcome is stamped on every actionable risk Action of the
 *      appointment; when there is none, a NO_CONTACT_CALL row is created for
 *      it, which is what brings a «не дозвонился» row back two hours later
 *      and what the «Обработано сегодня» trail reads;
 *   3. a promised call the visit's risk rows cannot carry (after the visit
 *      time, or on the return day) goes to a PATIENT_CALLBACK task, and those
 *      rows are closed (audit AC-09, see `outcome.ts`);
 *   4. `Patient.lastContactedAt` advances only when somebody actually spoke
 *      to the patient.
 *
 * «Перенести» is not recorded here (audit AC-10): the row's button opens the
 * visit's drawer, and the saved move records it (`recordRescheduleOutcome`,
 * the same steps 2 and 4), so the endpoint refuses it.
 *
 * Caller MUST be inside a TENANT context (the route wrapper provides it).
 */
import type { Action } from "@/generated/prisma/client";
import {
  IN_CLINIC_APPOINTMENT_STATUSES,
  RISK_TODAY_APPOINTMENT_STATUSES,
  riskDedupeKeysOf,
  type NoContactCallPayload,
} from "@/lib/actions/types";
import { prisma } from "@/lib/prisma";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";

import { clinicTodayBounds } from "./clinic-day";
import {
  applyOutcomeToAppointment,
  callbackOutlivesVisit,
  normalizeOutcomeInput,
  outcomeReachedPatient,
  outcomeRecordedByTheMove,
  outcomeStamp,
  returnDayIsLater,
  scheduleCallbackTask,
  type OutcomeDomainResult,
  type OutcomeInput,
} from "./outcome";
import { upsertAction } from "./repository";

/** Dedupe keys of every risk Action of one appointment (`riskDedupeKeysOf`). */
export const riskDedupeKeys = riskDedupeKeysOf;

export type StampedAction = {
  id: string;
  type: string;
  oldStatus: string;
  newStatus: string;
  callAttempts: number;
};

export type RiskOutcomeResult =
  | { ok: false; reason: "not_found" }
  /** Not a risk-today row: another day, or the visit is already over
   *  (cancelled, completed, no-show). Nothing was recorded. */
  | { ok: false; reason: "not_risk_today" }
  /** Today's visit, but the patient has arrived (WAITING / IN_PROGRESS):
   *  there is nobody to call. Nothing was recorded. */
  | { ok: false; reason: "patient_in_clinic" }
  /** «Хочет прийти позже» with a return day that is not after the visit's
   *  day. Nothing was recorded. */
  | { ok: false; reason: "return_day_not_later" }
  /** The appointment refused the side effect (already cancelled, completed…):
   *  nothing was recorded, the row is stale. */
  | { ok: false; reason: "not_applied"; detail: string }
  /** «Перенести» sent as a call outcome: only the move records it (audit
   *  AC-10). Nothing was recorded. */
  | { ok: false; reason: "reschedule_in_drawer" }
  | {
      ok: true;
      appointmentId: string;
      patientId: string;
      actions: StampedAction[];
      /** Set when the appointment had no risk Action and one was created. */
      createdActionId: string | null;
      /** The PATIENT_CALLBACK task that carries the promised call, if any. */
      callbackActionId: string | null;
      contactBumped: boolean;
      domain: OutcomeDomainResult;
    };

const DAY_MS = 24 * 60 * 60 * 1000;

export async function recordRiskOutcome(params: {
  clinicId: string;
  actorId: string;
  appointmentId: string;
  input: OutcomeInput;
  now?: Date;
}): Promise<RiskOutcomeResult> {
  const { clinicId, actorId } = params;
  const input = normalizeOutcomeInput(params.input);
  const now = params.now ?? new Date();
  if (outcomeRecordedByTheMove(input.outcome)) {
    return { ok: false, reason: "reschedule_in_drawer" };
  }

  const appt = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    select: {
      id: true,
      clinicId: true,
      date: true,
      status: true,
      patientId: true,
      patient: { select: { fullName: true, lastContactedAt: true } },
      doctor: { select: { nameRu: true } },
    },
  });
  if (!appt || appt.clinicId !== clinicId) return { ok: false, reason: "not_found" };

  // The same eligibility as the risk-today GET: the clinic's today, in its
  // own timezone, and a status the list shows.
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { timezone: true },
  });
  const today = clinicTodayBounds(now, clinic?.timezone || "Asia/Tashkent");
  const isToday = appt.date >= today.start && appt.date < today.end;
  if (
    isToday &&
    (IN_CLINIC_APPOINTMENT_STATUSES as readonly string[]).includes(appt.status)
  ) {
    return { ok: false, reason: "patient_in_clinic" };
  }
  const listed =
    isToday &&
    (RISK_TODAY_APPOINTMENT_STATUSES as readonly string[]).includes(appt.status);
  if (!listed) return { ok: false, reason: "not_risk_today" };
  if (!returnDayIsLater(input, appt.date)) {
    return { ok: false, reason: "return_day_not_later" };
  }
  const handedOff = callbackOutlivesVisit(input, appt.date);

  // Read before the side effect: a cancel retires the visit's risk rows
  // (AC-17), and the outcome must still land on the rows the list showed.
  const actionable = await actionableRiskRows(clinicId, appt.id, now);

  const domain = await applyOutcomeToAppointment({
    outcome: input.outcome,
    appointmentId: appt.id,
    clinicId,
    actorId,
    note: input.note,
  });
  if (domain && !domain.ok) {
    return { ok: false, reason: "not_applied", detail: domain.reason };
  }

  const { actions, createdActionId } = await stampRiskRows({
    clinicId,
    actorId,
    visit: {
      id: appt.id,
      date: appt.date,
      patientId: appt.patientId,
      patientName: appt.patient.fullName,
      lastContactedAt: appt.patient.lastContactedAt,
      doctorName: appt.doctor?.nameRu ?? "",
    },
    actionable,
    input,
    now,
    dayEnd: today.end,
    handedOff,
  });

  const callbackActionId = handedOff
    ? (
        await scheduleCallbackTask(prisma, {
          clinicId,
          appointment: {
            id: appt.id,
            date: appt.date,
            patientId: appt.patientId,
            patientName: appt.patient.fullName,
            doctorName: appt.doctor?.nameRu ?? "",
          },
          input,
        })
      ).id
    : null;

  const contactBumped = outcomeReachedPatient(input.outcome);
  if (contactBumped) await bumpPatientLastContact(appt.patientId, now);

  return {
    ok: true,
    appointmentId: appt.id,
    patientId: appt.patientId,
    actions,
    createdActionId,
    callbackActionId,
    contactBumped,
    domain,
  };
}

/**
 * The visit's risk rows an outcome acts on, i.e. what its risk-today row was
 * built from: OPEN, or SNOOZED with an elapsed timer. A live snooze keeps the
 * row off the list, so a callback promised for later («Перезвонить в 13:00»)
 * is not answered by a call made now.
 */
async function actionableRiskRows(
  clinicId: string,
  appointmentId: string,
  now: Date,
): Promise<Action[]> {
  const attached = await prisma.action.findMany({
    where: {
      clinicId,
      dedupeKey: { in: riskDedupeKeys(appointmentId) },
      status: { in: ["OPEN", "SNOOZED"] },
    },
  });
  return attached.filter(
    (a) => a.status === "OPEN" || !a.snoozeUntil || a.snoozeUntil <= now,
  );
}

/** The visit a risk-today outcome is about, as the list showed it. */
type RiskVisit = {
  id: string;
  date: Date;
  patientId: string;
  patientName: string;
  lastContactedAt: Date | null;
  doctorName: string;
};

/**
 * Stamp the outcome on the visit's actionable risk rows. When there is none
 * (the row surfaced only because the patient has not been in touch), the
 * NO_CONTACT_CALL it stands for is created first: that row is what brings a
 * «не дозвонился» back two hours later and what «Обработано сегодня» reads.
 */
async function stampRiskRows(params: {
  clinicId: string;
  actorId: string;
  visit: RiskVisit;
  actionable: Action[];
  input: OutcomeInput;
  now: Date;
  /** End of the clinic day the list showed the visit on. */
  dayEnd: Date;
  handedOff?: boolean;
}): Promise<{ actions: StampedAction[]; createdActionId: string | null }> {
  const { clinicId, actorId, visit, input, now } = params;
  let createdActionId: string | null = null;
  const targets = [...params.actionable];
  if (targets.length === 0) {
    const lc = visit.lastContactedAt;
    const payload: NoContactCallPayload = {
      type: "NO_CONTACT_CALL",
      appointmentId: visit.id,
      patientId: visit.patientId,
      patientName: visit.patientName,
      appointmentAt: visit.date.toISOString(),
      doctorName: visit.doctorName,
      daysSinceContact: lc
        ? Math.floor((now.getTime() - lc.getTime()) / DAY_MS)
        : null,
    };
    const created = await upsertAction(prisma, clinicId, payload, {
      deeplinkPath: `/crm/patients/${visit.patientId}`,
      // The call is about this visit: once its clinic day is over the task
      // is moot.
      expiresAt: params.dayEnd,
    });
    createdActionId = created.id;
    const row = await prisma.action.findUnique({ where: { id: created.id } });
    if (row) targets.push(row);
  }

  const actions: StampedAction[] = [];
  for (const before of targets) {
    const after = await prisma.action.update({
      where: { id: before.id },
      data: outcomeStamp(before, input, actorId, now, {
        handedOff: params.handedOff,
      }),
    });
    actions.push({
      id: before.id,
      type: before.type,
      oldStatus: before.status,
      newStatus: after.status,
      callAttempts: after.callAttempts,
    });
  }
  return { actions, createdActionId };
}

export type RescheduleOutcomeResult =
  /** The move was not one of the risk list's rows: nothing was recorded. */
  | { recorded: false }
  | {
      recorded: true;
      appointmentId: string;
      patientId: string;
      actions: StampedAction[];
      /** Set when the visit had no risk Action and one was created. */
      createdActionId: string | null;
      contactBumped: boolean;
    };

/**
 * Record «Перенести» for a visit moved from the risk-today list (audit
 * AC-10), once the new start is committed. The appointment PATCH calls it
 * only for a move saved in the drawer that the row's «Перенести» opened
 * (`riskOutcome` in the body).
 *
 * The button used to record the outcome first and only then open the
 * drawer: reception interrupted there left a visit «перенесён» that was
 * still at 15:00, out of every list. Now the saved move writes what that
 * outcome wrote: the visit's actionable risk rows close with RESCHEDULED and
 * the person who moved it, a NO_CONTACT_CALL is created for a row that was
 * only «не на связи», and the patient counts as contacted (reception has
 * just agreed the new time with them). Without the last two the row stayed
 * in the list after a move later today, and was flagged «не на связи» again
 * on the new day.
 *
 * Every other move (a calendar drag, the bulk shift, a doctor's PATCH)
 * records nothing: nobody called the patient. Its open risk rows follow the
 * visit on the engine's next pass, as they always did.
 *
 * `before` is the visit as the list showed it: the move is a risk-today
 * outcome only if that was one of its rows (today's clinic day, BOOKED or
 * CONFIRMED), the same rule as `recordRiskOutcome`. Best effort: never
 * throws, the move is already committed. Caller MUST be inside a TENANT
 * context.
 */
export async function recordRescheduleOutcome(params: {
  clinicId: string;
  actorId: string;
  before: { id: string; date: Date; status: string };
  now?: Date;
}): Promise<RescheduleOutcomeResult> {
  const { clinicId, actorId, before } = params;
  const now = params.now ?? new Date();
  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const today = clinicTodayBounds(now, clinic?.timezone || "Asia/Tashkent");
    const listed =
      before.date >= today.start &&
      before.date < today.end &&
      (RISK_TODAY_APPOINTMENT_STATUSES as readonly string[]).includes(before.status);
    if (!listed) return { recorded: false };

    const appt = await prisma.appointment.findUnique({
      where: { id: before.id },
      select: {
        clinicId: true,
        patientId: true,
        patient: { select: { fullName: true, lastContactedAt: true } },
        doctor: { select: { nameRu: true } },
      },
    });
    if (!appt || appt.clinicId !== clinicId) return { recorded: false };

    const input: OutcomeInput = {
      outcome: "RESCHEDULED",
      note: null,
      callbackAt: null,
    };
    const { actions, createdActionId } = await stampRiskRows({
      clinicId,
      actorId,
      visit: {
        id: before.id,
        date: before.date,
        patientId: appt.patientId,
        patientName: appt.patient.fullName,
        lastContactedAt: appt.patient.lastContactedAt,
        doctorName: appt.doctor?.nameRu ?? "",
      },
      actionable: await actionableRiskRows(clinicId, before.id, now),
      input,
      now,
      dayEnd: today.end,
    });
    const contactBumped = outcomeReachedPatient(input.outcome);
    if (contactBumped) await bumpPatientLastContact(appt.patientId, now);
    return {
      recorded: true,
      appointmentId: before.id,
      patientId: appt.patientId,
      actions,
      createdActionId,
      contactBumped,
    };
  } catch (e) {
    console.warn(
      `[actions.recordRescheduleOutcome] ${before.id} skipped: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { recorded: false };
  }
}
