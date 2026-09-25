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
 *   1. the appointment side effect runs once (confirm / cancel), before any
 *      Action is written, so a refused side effect leaves nothing behind;
 *   2. the outcome is stamped on every actionable risk Action of the
 *      appointment; when there is none, a NO_CONTACT_CALL row is created for
 *      it, which is what brings a «не дозвонился» row back two hours later
 *      and what the «Обработано сегодня» trail reads;
 *   3. `Patient.lastContactedAt` advances only when somebody actually spoke
 *      to the patient.
 *
 * Caller MUST be inside a TENANT context (the route wrapper provides it).
 */
import { tashkentDayBounds } from "@/lib/booking-validation";
import { dedupeKeyFor, type NoContactCallPayload } from "@/lib/actions/types";
import { prisma } from "@/lib/prisma";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";

import {
  applyOutcomeToAppointment,
  outcomeReachedPatient,
  outcomeStamp,
  type OutcomeDomainResult,
  type OutcomeInput,
} from "./outcome";
import { upsertAction } from "./repository";

/**
 * Dedupe keys of every risk Action (`RISK_ACTION_TYPES`) that can exist for
 * one appointment. Built through `dedupeKeyFor` with stub payloads (only
 * `appointmentId` feeds these keys) so a key-format change can never desync
 * this lookup.
 */
export function riskDedupeKeys(appointmentId: string): string[] {
  const base = { appointmentId, patientId: "", patientName: "", appointmentAt: "" };
  return [
    dedupeKeyFor({ type: "NO_SHOW_RISK_HIGH", ...base, risk: 0 }),
    dedupeKeyFor({ type: "UNCONFIRMED_24H", ...base, doctorName: "" }),
    dedupeKeyFor({
      type: "NO_CONTACT_CALL",
      ...base,
      doctorName: "",
      daysSinceContact: null,
    }),
  ];
}

export type StampedAction = {
  id: string;
  type: string;
  oldStatus: string;
  newStatus: string;
  callAttempts: number;
};

export type RiskOutcomeResult =
  | { ok: false; reason: "not_found" }
  /** The appointment refused the side effect (already cancelled, completed…):
   *  nothing was recorded, the row is stale. */
  | { ok: false; reason: "not_applied"; detail: string }
  | {
      ok: true;
      appointmentId: string;
      patientId: string;
      actions: StampedAction[];
      /** Set when the appointment had no risk Action and one was created. */
      createdActionId: string | null;
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
  const { clinicId, actorId, input } = params;
  const now = params.now ?? new Date();

  const appt = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    select: {
      id: true,
      clinicId: true,
      date: true,
      patientId: true,
      patient: { select: { fullName: true, lastContactedAt: true } },
      doctor: { select: { nameRu: true } },
    },
  });
  if (!appt || appt.clinicId !== clinicId) return { ok: false, reason: "not_found" };

  // Actionable = what the risk-today row was built from: OPEN, or SNOOZED
  // with an elapsed timer (a live snooze keeps the row off the list).
  const attached = await prisma.action.findMany({
    where: {
      clinicId,
      dedupeKey: { in: riskDedupeKeys(appt.id) },
      status: { in: ["OPEN", "SNOOZED"] },
    },
  });
  const actionable = attached.filter(
    (a) => a.status === "OPEN" || !a.snoozeUntil || a.snoozeUntil <= now,
  );

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

  let createdActionId: string | null = null;
  const targets = [...actionable];
  if (targets.length === 0) {
    const lc = appt.patient.lastContactedAt;
    const payload: NoContactCallPayload = {
      type: "NO_CONTACT_CALL",
      appointmentId: appt.id,
      patientId: appt.patientId,
      patientName: appt.patient.fullName,
      appointmentAt: appt.date.toISOString(),
      doctorName: appt.doctor?.nameRu ?? "",
      daysSinceContact: lc
        ? Math.floor((now.getTime() - lc.getTime()) / DAY_MS)
        : null,
    };
    const created = await upsertAction(prisma, clinicId, payload, {
      deeplinkPath: `/crm/patients/${appt.patientId}`,
      // The call is about this visit: once its clinic day is over the task
      // is moot. The explicit expiry also keeps it out of the 48h sweep.
      expiresAt: tashkentDayBounds(appt.date).dayEnd,
    });
    createdActionId = created.id;
    const row = await prisma.action.findUnique({ where: { id: created.id } });
    if (row) targets.push(row);
  }

  const actions: StampedAction[] = [];
  for (const before of targets) {
    const after = await prisma.action.update({
      where: { id: before.id },
      data: outcomeStamp(before, input, actorId, now),
    });
    actions.push({
      id: before.id,
      type: before.type,
      oldStatus: before.status,
      newStatus: after.status,
      callAttempts: after.callAttempts,
    });
  }

  const contactBumped = outcomeReachedPatient(input.outcome);
  if (contactBumped) await bumpPatientLastContact(appt.patientId, now);

  return {
    ok: true,
    appointmentId: appt.id,
    patientId: appt.patientId,
    actions,
    createdActionId,
    contactBumped,
    domain,
  };
}
