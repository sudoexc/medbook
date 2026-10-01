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

/**
 * A visit with an outcome: the patient came (COMPLETED) or did not
 * (NO_SHOW). The no-show rate is NO_SHOW over these, the definition the
 * report builder's `no_show_rate` measure and the per-doctor no-show ranking
 * already use. A cancelled visit or one of today's patients who has not come
 * yet is not a «showed up» and must not dilute the rate (audit AN-07).
 */
export function isResolvedVisit(status: string): boolean {
  return status === "COMPLETED" || status === "NO_SHOW";
}

/**
 * The revenue chip (audit AN-07): the current window against the previous
 * one of equal length, and only when both are made of recorded payments.
 * Null, so no chip, when the clinic does not record payments in the CRM,
 * when the current window has no payment at all (the tile then says «нет
 * данных», a «−100 %» next to it would be noise), or when the previous
 * window starts before recording did: half a window of recorded payments
 * against a full one is not growth.
 */
export function revenueDeltaPct(input: {
  trackedSince: Date | null;
  current: { amount: number; payments: number };
  previous: { amount: number; from: Date };
}): number | null {
  if (input.trackedSince === null) return null;
  if (input.current.payments === 0) return null;
  if (input.previous.from < input.trackedSince) return null;
  return relativeDeltaPct(input.current.amount, input.previous.amount);
}
