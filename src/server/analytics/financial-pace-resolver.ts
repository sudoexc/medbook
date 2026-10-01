/**
 * Phase 18 Wave 1 — financial-pace resolver.
 *
 * Reads `mv_financial_pace` (one row per clinicId × Tashkent day, covering
 * 90 days back through 30 days forward — see migration). Returns a snapshot
 * keyed to today / month-to-date / forecast horizon.
 *
 * Forecast horizon is a thin extrapolation: month-to-date collected
 * revenue scaled to month length. The W3 / W4 builders may swap in a
 * proper time-series projection later.
 *
 * Audit AN-25:
 *   - the window is one rule (`financialWindow`) for the page's first
 *     render and its 60 s auto-refresh, which used to call the API with no
 *     parameters and get the current month: a minute after opening, the
 *     90-day trend shrank to the month so far (to nothing on the 1st);
 *   - «today», the month and the projection are Tashkent days (the MV is
 *     bucketed by Tashkent day since 20261001100000_analytics_tashkent_mvs);
 *   - «Получено сегодня» reads `Payment` live, so a payment taken a minute
 *     ago shows without waiting for the hourly REFRESH;
 *   - `dataAsOf` is when the MV was refreshed ("refreshedAt"), not the time
 *     of the request, which made hour-old numbers look live;
 *   - money collected is only shown when the clinic records payments in
 *     the CRM (`paymentsRecordedSince`), otherwise the page says so.
 */

import {
  FINANCIAL_TREND_DAYS,
  financialWindow,
  projectMonthEnd,
  type FinancialWindow,
} from "@/lib/analytics/dashboard-math";
import { tashkentDayBoundsForDateString } from "@/lib/booking-validation";
import type { prisma as prismaClient } from "@/lib/prisma";
import { paymentsRecordedSince } from "@/server/patient/finance";

export { FINANCIAL_TREND_DAYS, financialWindow };

interface RawDayRow {
  clinicId: string;
  day: Date;
  revenueCollectedTiins: bigint | number;
  revenueScheduledTiins: bigint | number;
  noShowLossTiins: bigint | number;
  refreshedAt: Date | null;
}

export interface FinancialDailyPoint {
  day: string; // YYYY-MM-DD
  revenueCollectedTiins: number;
  revenueScheduledTiins: number;
  noShowLossTiins: number;
}

export interface FinancialPaceSnapshot {
  today: FinancialDailyPoint | null;
  /** The Tashkent day the snapshot calls «today». */
  todayKey: string;
  /**
   * PAID payments of today, read live from `Payment`. Null when the clinic
   * does not record payments in the CRM.
   */
  todayCollectedLiveTiins: number | null;
  /** `Clinic.paymentsTrackedSince` is set. */
  paymentsTracked: boolean;
  /** Month-to-date totals (from the 1st through `now`). */
  mtd: {
    revenueCollectedTiins: number;
    revenueScheduledTiins: number;
    noShowLossTiins: number;
  };
  /** Naive linear forecast: MTD-collected scaled to full month. */
  forecastMonthEndTiins: number;
  daily: FinancialDailyPoint[];
  /** Inclusive first day and exclusive end of `daily`, Tashkent days. */
  range: { from: string; toExcl: string };
  /** When the MV's numbers were computed (its last REFRESH); null if never. */
  dataAsOf: string | null;
  /** When this snapshot was assembled (the request). */
  generatedAt: string;
  source: "mv:mv_financial_pace";
}

/** The MV's `day` (a DATE, handed back as that day's UTC midnight) as a key. */
function dayKeyOf(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** Pure: the snapshot from the MV rows of the window. */
export function buildFinancialSnapshot(input: {
  rows: ReadonlyArray<RawDayRow>;
  window: FinancialWindow;
  todayCollectedLiveTiins: number | null;
  paymentsTracked: boolean;
  now: Date;
}): FinancialPaceSnapshot {
  const { window } = input;
  let today: FinancialDailyPoint | null = null;
  const daily: FinancialDailyPoint[] = [];
  let mtdCollected = 0;
  let mtdScheduled = 0;
  let mtdNoShowLoss = 0;
  let refreshedAt: number | null = null;
  for (const r of input.rows) {
    const key = dayKeyOf(r.day);
    const point: FinancialDailyPoint = {
      day: key,
      revenueCollectedTiins: Number(r.revenueCollectedTiins),
      revenueScheduledTiins: Number(r.revenueScheduledTiins),
      noShowLossTiins: Number(r.noShowLossTiins),
    };
    if (key === window.todayKey && input.todayCollectedLiveTiins !== null) {
      // The live figure replaces the hour-old one, in the trend too.
      point.revenueCollectedTiins = input.todayCollectedLiveTiins;
    }
    daily.push(point);
    if (key === window.todayKey) today = point;
    if (key >= window.monthStart && key < window.nextMonthStart) {
      mtdCollected += point.revenueCollectedTiins;
      mtdScheduled += point.revenueScheduledTiins;
      mtdNoShowLoss += point.noShowLossTiins;
    }
    if (r.refreshedAt) {
      const ms = new Date(r.refreshedAt).getTime();
      if (Number.isFinite(ms) && (refreshedAt === null || ms > refreshedAt)) refreshedAt = ms;
    }
  }

  // Forecast: MTD-collected scaled to the month's length on the Tashkent
  // day of `todayKey`, the client card's formula.
  const forecastMonthEndTiins = projectMonthEnd(
    mtdCollected,
    new Date(`${window.todayKey}T12:00:00+05:00`),
  ).projectedTiins;

  return {
    today,
    todayKey: window.todayKey,
    todayCollectedLiveTiins: input.todayCollectedLiveTiins,
    paymentsTracked: input.paymentsTracked,
    mtd: {
      revenueCollectedTiins: mtdCollected,
      revenueScheduledTiins: mtdScheduled,
      noShowLossTiins: mtdNoShowLoss,
    },
    forecastMonthEndTiins,
    daily,
    range: { from: window.from, toExcl: window.toExcl },
    dataAsOf: refreshedAt === null ? null : new Date(refreshedAt).toISOString(),
    generatedAt: input.now.toISOString(),
    source: "mv:mv_financial_pace",
  };
}

const SQL = `
SELECT
  "clinicId",
  "day",
  "revenueCollectedTiins",
  "revenueScheduledTiins",
  "noShowLossTiins",
  "refreshedAt"
FROM "mv_financial_pace"
WHERE "clinicId" = $1
  AND "day" >= $2::date
  AND "day" <  $3::date
ORDER BY "day" ASC
`.trim();

export interface FinancialPaceOptions {
  /** Trend length in days back to today, 1..90. Defaults to 90. */
  trendDays?: number;
}

type FinancialDb = Pick<typeof prismaClient, "$queryRawUnsafe" | "payment" | "clinic">;

export async function resolveFinancialPace(
  prisma: FinancialDb,
  clinicId: string,
  opts: FinancialPaceOptions = {},
  now: Date = new Date(),
): Promise<FinancialPaceSnapshot> {
  const window = financialWindow(now, opts.trendDays);

  const trackedSince = await paymentsRecordedSince(
    clinicId,
    prisma as unknown as typeof prismaClient,
  );
  const paymentsTracked = trackedSince !== null;
  let todayCollectedLiveTiins: number | null = null;
  if (paymentsTracked) {
    const { dayStart, dayEnd } = tashkentDayBoundsForDateString(window.todayKey);
    const agg = await prisma.payment.aggregate({
      where: { clinicId, status: "PAID", paidAt: { gte: dayStart, lt: dayEnd } },
      _sum: { amount: true },
    });
    todayCollectedLiveTiins = agg._sum.amount ?? 0;
  }

  let rows: RawDayRow[];
  try {
    rows = await prisma.$queryRawUnsafe<RawDayRow[]>(
      SQL,
      clinicId,
      window.from,
      window.toExcl,
    );
  } catch (e) {
    // MV exists but never refreshed yet — return an empty snapshot rather
    // than 500. Same fallback the cohort resolver uses.
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("has not been populated")) throw e;
    rows = [];
  }

  return buildFinancialSnapshot({
    rows,
    window,
    todayCollectedLiveTiins,
    paymentsTracked,
    now,
  });
}
