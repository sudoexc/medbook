/**
 * Phase 18 Wave 1 — financial-pace resolver.
 *
 * Reads `mv_financial_pace` (one row per clinicId × day, covering 90 days
 * back through 30 days forward — see migration). Returns a snapshot keyed
 * to today / month-to-date / forecast horizon.
 *
 * Forecast horizon is a thin extrapolation: month-to-date collected
 * revenue scaled to month length. The W3 / W4 builders may swap in a
 * proper time-series projection later.
 */

import type { RawQueryClient } from "./cohort-resolver";

interface RawDayRow {
  clinicId: string;
  day: Date;
  revenueCollectedTiins: bigint | number;
  revenueScheduledTiins: bigint | number;
  noShowLossTiins: bigint | number;
}

export interface FinancialDailyPoint {
  day: string; // YYYY-MM-DD
  revenueCollectedTiins: number;
  revenueScheduledTiins: number;
  noShowLossTiins: number;
}

export interface FinancialPaceSnapshot {
  today: FinancialDailyPoint | null;
  /** Month-to-date totals (from the 1st through `now`). */
  mtd: {
    revenueCollectedTiins: number;
    revenueScheduledTiins: number;
    noShowLossTiins: number;
  };
  /** Naive linear forecast: MTD-collected scaled to full month. */
  forecastMonthEndTiins: number;
  daily: FinancialDailyPoint[];
  generatedAt: string;
  source: "mv:mv_financial_pace";
}

const SQL = `
SELECT
  "clinicId",
  "day",
  "revenueCollectedTiins",
  "revenueScheduledTiins",
  "noShowLossTiins"
FROM "mv_financial_pace"
WHERE "clinicId" = $1
  AND "day" >= $2
  AND "day" <  $3
ORDER BY "day" ASC
`.trim();

function ymdKeyUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysInMonthUtc(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

export interface FinancialPaceOptions {
  /** Inclusive lower bound for daily breakdown. Defaults to first of this month. */
  dayFrom?: Date;
  /** Exclusive upper bound. Defaults to first of next month. */
  dayTo?: Date;
}

export async function resolveFinancialPace(
  prisma: RawQueryClient,
  clinicId: string,
  opts: FinancialPaceOptions = {},
  now: Date = new Date(),
): Promise<FinancialPaceSnapshot> {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const nextMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const from = opts.dayFrom ?? monthStart;
  const to = opts.dayTo ?? nextMonthStart;

  const raw = await prisma.$queryRawUnsafe<RawDayRow[]>(
    SQL,
    clinicId,
    from,
    to,
  );

  const todayKey = ymdKeyUtc(now);
  let today: FinancialDailyPoint | null = null;
  const daily: FinancialDailyPoint[] = [];
  let mtdCollected = 0;
  let mtdScheduled = 0;
  let mtdNoShowLoss = 0;
  for (const r of raw) {
    const day = new Date(r.day);
    const key = ymdKeyUtc(day);
    const point: FinancialDailyPoint = {
      day: key,
      revenueCollectedTiins: Number(r.revenueCollectedTiins),
      revenueScheduledTiins: Number(r.revenueScheduledTiins),
      noShowLossTiins: Number(r.noShowLossTiins),
    };
    daily.push(point);
    if (key === todayKey) today = point;
    if (day >= monthStart && day < nextMonthStart) {
      mtdCollected += point.revenueCollectedTiins;
      mtdScheduled += point.revenueScheduledTiins;
      mtdNoShowLoss += point.noShowLossTiins;
    }
  }

  // Forecast: scale MTD-collected to full month length.
  const dayOfMonth = now.getUTCDate();
  const totalDays = daysInMonthUtc(now.getUTCFullYear(), now.getUTCMonth());
  // Multiply before dividing — same formula as `projectMonthEnd` so the
  // resolver and the client-side helper agree on every projection. Avoids a
  // float-rounding drift on the day-fraction.
  const forecastMonthEndTiins =
    dayOfMonth > 0
      ? Math.round((mtdCollected * totalDays) / dayOfMonth)
      : mtdCollected;

  return {
    today,
    mtd: {
      revenueCollectedTiins: mtdCollected,
      revenueScheduledTiins: mtdScheduled,
      noShowLossTiins: mtdNoShowLoss,
    },
    forecastMonthEndTiins,
    daily,
    generatedAt: new Date().toISOString(),
    source: "mv:mv_financial_pace",
  };
}
