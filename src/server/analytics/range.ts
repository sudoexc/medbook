/**
 * Pure helpers for the analytics dashboard window resolution. Factored
 * out of `/api/crm/analytics/route.ts` so unit tests don't have to import
 * the full handler (which transitively pulls next-auth).
 *
 * All day boundaries are **Tashkent** (clinic time, UTC+5, no DST) — the
 * old `setHours(0,0,0,0)` variant used server-local midnight, which on the
 * UTC prod box shifted every window by 5 hours vs. the clinic's day.
 * Tashkent has no DST, so N×24h arithmetic on a Tashkent midnight always
 * lands on another Tashkent midnight.
 */
import {
  tashkentDayBounds,
  tashkentDayBoundsForDateString,
  tashkentComponents,
} from "@/lib/booking-validation";

export type AnalyticsPeriod = "week" | "month" | "quarter" | "custom";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight (Tashkent) of the civil day containing `d`. */
export function startOfDay(d: Date): Date {
  return tashkentDayBounds(d).dayStart;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Parse YYYY-MM-DD as a Tashkent calendar day → its midnight instant. */
export function parseYmd(s: string | null): Date | null {
  if (!s) return null;
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(s)) return null;
  const d = tashkentDayBoundsForDateString(s).dayStart;
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve the `[from, to)` window from query params.
 *
 * Returns `to` exclusive (tomorrow-at-midnight so "today" is included).
 */
export function resolveAnalyticsRange(
  url: URL,
  now: Date = new Date(),
): { from: Date; to: Date; period: AnalyticsPeriod } {
  const explicitFrom = parseYmd(url.searchParams.get("from"));
  const explicitTo = parseYmd(url.searchParams.get("to"));

  if (explicitFrom && explicitTo) {
    return {
      from: explicitFrom,
      to: addDays(explicitTo, 1),
      period: "custom",
    };
  }

  const period = (url.searchParams.get("period") as AnalyticsPeriod) ?? "month";
  const { dayStart: todayStart, dayEnd: tomorrow } = tashkentDayBounds(now);
  switch (period) {
    case "week":
      return { from: addDays(todayStart, -6), to: tomorrow, period };
    case "quarter":
      return { from: addDays(todayStart, -89), to: tomorrow, period };
    case "month":
    default:
      return { from: addDays(todayStart, -29), to: tomorrow, period: "month" };
  }
}

/** Tashkent civil date (YYYY-MM-DD) of the instant — daily bucket key. */
export function ymdKey(d: Date): string {
  return tashkentComponents(d).date;
}

export function eachDay(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    out.push(ymdKey(d));
  }
  return out;
}
