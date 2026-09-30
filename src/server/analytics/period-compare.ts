/**
 * Period-over-period deltas for the analytics dashboard (audit UX-03).
 *
 * The chips used to be computed in the browser by splitting the period in
 * two halves: a week (7 days) became 3 days against 4, so a perfectly flat
 * revenue always read about «+33 %», and the conversion chips were
 * «synthesized from sparkline halves». Now every delta compares the period
 * with the one of equal length right before it, on the server, and is null
 * (no chip) when the earlier period has nothing to compare with.
 */
import { addDays } from "@/server/analytics/range";

const DAY_MS = 86_400_000;

/** The window of equal length that ends where `[from, to)` starts. */
export function previousWindow(from: Date, to: Date): { from: Date; to: Date } {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  return { from: addDays(from, -days), to: from };
}

/**
 * Relative change in percent, one decimal. Null when the earlier period is
 * zero or less: growth from nothing has no percentage.
 */
export function relativeDeltaPct(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Change of a rate in percentage points, one decimal. Null when either
 * period has no denominator (no visits, no working time).
 */
export function rateDeltaPp(
  current: { part: number; whole: number },
  previous: { part: number; whole: number },
): number | null {
  if (!(current.whole > 0) || !(previous.whole > 0)) return null;
  const pp = (current.part / current.whole - previous.part / previous.whole) * 100;
  return Math.round(pp * 10) / 10;
}
