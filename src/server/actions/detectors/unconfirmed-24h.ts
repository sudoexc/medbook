/**
 * Detector: UNCONFIRMED_24H (Stage 2.C — 72h horizon).
 *
 * The ActionType constant stays `UNCONFIRMED_24H` (it's a stable label, not a
 * window assertion). Stage 2.C widens the actual lookahead to **72h** so the
 * Action Center surfaces "still needs confirming" rows earlier, and re-tiers
 * severity by proximity.
 *
 * Predicate switched from `status === 'BOOKED'` to `confirmedAt IS NULL`. That
 * is the new canonical definition of "still needs confirming" — a patient may
 * be flipped to WAITING by reception before any confirm path has fired
 * (corner case in the Stage 1 flow), and BOOKED also includes rows that have
 * already been confirmed via SMS_REPLY / TG_BUTTON. CANCELLED / NO_SHOW /
 * COMPLETED are still excluded — once a visit is closed out we don't ask the
 * receptionist to chase confirmation.
 *
 * Severity tiers (computed via `severityForUnconfirmed24h`, fed into the
 * engine's per-detector severity helper so `upsertAction` updates a row's
 * severity in place as the clock approaches the appointment):
 *
 *   - < 2h   → critical
 *   - < 12h  → high
 *   - < 24h  → medium
 *   - < 72h  → low
 *
 * `expiresAt` is intentionally not set here — the appointment status flip
 * (CANCELLED / NO_SHOW / COMPLETED) makes the row stop satisfying the
 * predicate, and the engine's 48h `updatedAt` sweep covers stragglers.
 *
 * The composite index `Appointment_clinicId_date_confirmedAt_idx` exists
 * exactly for this scan — keep the `date` range + `confirmedAt: null`
 * predicate intact so the planner can use it.
 */
import type { ActionSeverity, Unconfirmed24hPayload } from "@/lib/actions/types";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { addHours } from "./_shared";

type ApptRow = {
  id: string;
  date: Date;
  patientId: string;
  patient: { fullName: string };
  doctor: { nameRu: string };
};

/** Hard-coded 72h lookahead — wider than `config.unconfirmedHoursAhead`
 *  (24h, kept for backward-compat with other call sites). Stage 2.C decision:
 *  surface the row early, let severity reflect proximity instead. */
const HORIZON_HOURS = 72;

export async function detectUnconfirmed24h(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  _config: DetectorConfig,
): Promise<Unconfirmed24hPayload[]> {
  const horizon = addHours(now, HORIZON_HOURS);

  const rows = (await prisma.appointment.findMany({
    where: {
      // `confirmedAt IS NULL` is the new canonical "still needs confirming"
      // predicate. Excludes everything Stage 1's `confirmAppointment()` has
      // stamped (BOOKING_AUTO / MANUAL_CRM / SMS_REPLY / TG_BUTTON /
      // INBOUND_CALL) while picking up TELEGRAM/WEBSITE bookings that stay
      // BOOKED with confirmedAt=null until the patient acts.
      confirmedAt: null,
      // Closed-out visits never need chasing — exclude regardless of
      // confirmedAt (corner case: COMPLETED rows that were never confirmed
      // because the patient walked in unannounced).
      status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] },
      date: { gte: now, lte: horizon },
    },
    select: {
      id: true,
      date: true,
      patientId: true,
      patient: { select: { fullName: true } },
      doctor: { select: { nameRu: true } },
    },
  })) as ApptRow[];

  return rows.map((r) => ({
    type: "UNCONFIRMED_24H",
    appointmentId: r.id,
    patientId: r.patientId,
    patientName: r.patient.fullName,
    appointmentAt: r.date.toISOString(),
    doctorName: r.doctor.nameRu,
  }));
}

/**
 * Severity for an UNCONFIRMED_24H row. Called by the engine per-pass so the
 * tier updates in place via `upsertAction` as the appointment approaches —
 * the dedupeKey is `appointmentId`-only, so the same row's severity walks
 * low → medium → high → critical without spawning duplicates.
 */
export function severityForUnconfirmed24h(
  payload: Unconfirmed24hPayload,
  now: Date,
): ActionSeverity {
  const hoursUntil =
    (new Date(payload.appointmentAt).getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hoursUntil < 2) return "critical";
  if (hoursUntil < 12) return "high";
  if (hoursUntil < 24) return "medium";
  return "low";
}
