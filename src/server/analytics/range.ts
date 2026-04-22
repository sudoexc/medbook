/**
 * Pure helpers for the analytics dashboard window resolution. Factored
 * out of `/api/crm/analytics/route.ts` so unit tests don't have to import
 * the full handler (which transitively pulls next-auth).
 */

export type AnalyticsPeriod = "week" | "month" | "quarter" | "custom";

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function parseYmd(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    0,
    0,
    0,
    0,
  );
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
      from: startOfDay(explicitFrom),
      to: addDays(startOfDay(explicitTo), 1),
      period: "custom",
    };
  }

  const period = (url.searchParams.get("period") as AnalyticsPeriod) ?? "month";
  const todayStart = startOfDay(now);
  const tomorrow = addDays(todayStart, 1);
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

export function ymdKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function eachDay(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    out.push(ymdKey(d));
  }
  return out;
}
