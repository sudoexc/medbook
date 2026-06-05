/**
 * Derived "overdue" state for appointment list views (CRM table, reception,
 * tiles). Lives client-side so a tick of `Date.now()` re-paints rows without
 * a server round-trip.
 *
 * Why it exists: a CONFIRMED row whose endDate has passed without anyone
 * marking the patient as arrived/no-show is the most common no-show — yet
 * the older heuristics here only flagged BOOKED/WAITING, so CONFIRMED
 * appointments from the mini-app/website channels stayed "low risk" all day.
 * The lifecycle-sweep worker also reads `isOverdue` via this module so a
 * future change to the definition propagates to the auto-NO_SHOW edge.
 */

import type { AppointmentStatus } from "@/lib/appointment-transitions";

/**
 * Pre-arrival statuses where "patient hasn't physically shown up yet" is
 * still possible. WAITING means the patient is already at reception, so
 * they're not overdue (the doctor is). IN_PROGRESS means the visit is
 * underway. Terminal statuses are obviously skipped.
 */
const OVERDUE_CANDIDATE_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "BOOKED",
  "CONFIRMED",
  "SKIPPED",
]);

/** Patient is already inside the clinic — different UX problem. */
const PRESENT_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  "WAITING",
  "IN_PROGRESS",
]);

/** Hard grace after the scheduled end before we flag a row as overdue. */
export const OVERDUE_GRACE_MIN = 15;

/** Grace before the lifecycle-sweep worker auto-flips a row to NO_SHOW. */
export const AUTO_NO_SHOW_GRACE_MIN = 60;

export type OverdueRowInput = {
  status: AppointmentStatus;
  date: string | Date;
  endDate: string | Date;
};

function toMs(v: string | Date): number {
  return typeof v === "string" ? new Date(v).getTime() : v.getTime();
}

export function isOverdueCandidateStatus(status: AppointmentStatus): boolean {
  return OVERDUE_CANDIDATE_STATUSES.has(status);
}

export function isPresentStatus(status: AppointmentStatus): boolean {
  return PRESENT_STATUSES.has(status);
}

/**
 * True when the scheduled window has elapsed and nobody marked the row as
 * arrived/no-show. The grace cushions doctors who run a few minutes long
 * before clicking "Принять".
 */
export function isOverdue(
  row: OverdueRowInput,
  now: number | Date = Date.now(),
): boolean {
  if (!OVERDUE_CANDIDATE_STATUSES.has(row.status)) return false;
  const nowMs = typeof now === "number" ? now : now.getTime();
  return nowMs > toMs(row.endDate) + OVERDUE_GRACE_MIN * 60_000;
}

/**
 * True when start has passed but endDate hasn't — patient is "late but
 * still inside their window". Reception should be calling, not marking
 * no-show yet.
 */
export function isRunningLate(
  row: OverdueRowInput,
  now: number | Date = Date.now(),
): boolean {
  if (!OVERDUE_CANDIDATE_STATUSES.has(row.status)) return false;
  const nowMs = typeof now === "number" ? now : now.getTime();
  const startMs = toMs(row.date);
  const endMs = toMs(row.endDate);
  return nowMs > startMs && nowMs <= endMs + OVERDUE_GRACE_MIN * 60_000;
}

/** Minutes elapsed past the scheduled start. Clamped at 0 for future rows. */
export function minutesPastStart(
  row: Pick<OverdueRowInput, "date">,
  now: number | Date = Date.now(),
): number {
  const nowMs = typeof now === "number" ? now : now.getTime();
  return Math.max(0, Math.round((nowMs - toMs(row.date)) / 60_000));
}

export type RiskBand = "overdue" | "high" | "medium" | "low" | "done";

/**
 * Mood for the "Риск no-show" column. Replaces the older 3-band scalar so
 * that overdue rows surface as a distinct "needs decision" state rather
 * than a stale low-confidence forecast.
 */
export function riskBand(
  row: OverdueRowInput & { channel?: string },
  now: number | Date = Date.now(),
): RiskBand {
  if (row.status === "COMPLETED") return "done";
  if (row.status === "NO_SHOW") return "overdue";
  if (row.status === "CANCELLED") return "done";
  if (isOverdue(row, now)) return "overdue";
  if (isRunningLate(row, now)) return "high";
  if (row.channel === "PHONE" || row.channel === "WEBSITE") return "medium";
  return "low";
}
