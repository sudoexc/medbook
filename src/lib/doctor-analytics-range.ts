/**
 * Window of the doctor's personal analytics (`/api/crm/doctors/me/analytics`).
 * Pure and client-safe: the route resolves the window with it and the
 * dashboard checks a custom range against the same cap before asking.
 *
 * The route builds one bucket per day of the window and used to accept any
 * pair of YYYY-MM-DD strings, so a mistyped «0001-01-01 → 9999-12-31»
 * allocated millions of buckets in the Node process the whole clinic shares
 * (audit DC-15). A year and a day covers every real question.
 */
import {
  tashkentDayBounds,
  tashkentDayBoundsForDateString,
} from "@/lib/booking-validation";
import { isTashkentDateString } from "@/lib/tashkent-time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest window, in days, the doctor analytics answers. */
export const DOCTOR_ANALYTICS_MAX_DAYS = 366;

export type DoctorAnalyticsRangeResult =
  | { ok: true; from: Date; toEnd: Date; dayCount: number }
  | { ok: false; reason: "invalid_date" | "to_before_from" | "range_too_long" };

/**
 * `from` inclusive, `toEnd` exclusive (the midnight after the `to` day), both
 * Tashkent. Either bound defaults to a 30-day window ending today.
 */
export function resolveDoctorAnalyticsRange(
  q: { from?: string; to?: string },
  now: Date = new Date(),
): DoctorAnalyticsRangeResult {
  if (
    (q.from !== undefined && !isTashkentDateString(q.from)) ||
    (q.to !== undefined && !isTashkentDateString(q.to))
  ) {
    return { ok: false, reason: "invalid_date" };
  }
  const today = tashkentDayBounds(now);
  const toEnd = q.to ? tashkentDayBoundsForDateString(q.to).dayEnd : today.dayEnd;
  const from = q.from
    ? tashkentDayBoundsForDateString(q.from).dayStart
    : new Date(today.dayStart.getTime() - 29 * DAY_MS);
  if (toEnd <= from) return { ok: false, reason: "to_before_from" };
  // Tashkent has no DST, so whole days divide exactly.
  const dayCount = Math.round((toEnd.getTime() - from.getTime()) / DAY_MS);
  if (dayCount > DOCTOR_ANALYTICS_MAX_DAYS) {
    return { ok: false, reason: "range_too_long" };
  }
  return { ok: true, from, toEnd, dayCount };
}
