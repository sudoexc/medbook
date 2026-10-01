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
 *     the CRM (`paymentsRecordedSince`), otherwise the page says so;
 *   - and only over the days it recorded all of them (review): the switch
 *     is turned on mid-month and mid-day, and the days before it are not
 *     zero takings. Month-to-date and the projection need the whole month
 *     recorded, the trend starts on the first fully recorded day.
 */

import {
  FINANCIAL_TREND_DAYS,
  financialWindow,
  projectMonthEnd,
  type FinancialWindow,
} from "@/lib/analytics/dashboard-math";
import { tashkentDayBoundsForDateString } from "@/lib/booking-validation";
import type { prisma as prismaClient } from "@/lib/prisma";
import { addTashkentDays, tashkentDateOf } from "@/lib/tashkent-time";
import { paymentsRecordedSince } from "@/server/patient/finance";
import { sumNetRevenue } from "@/server/analytics/net-revenue";

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
  /**
   * PAID payments of the day; null when the clinic did not record all of
   * that day's payments in the CRM (before `measuredFrom`, or never), which
   * is not the same as a day without takings.
   */
  revenueCollectedTiins: number | null;
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
  /**
   * When recording was switched on today: that moment (ISO), and
   * `todayCollectedLiveTiins` counts from it. Null otherwise.
   */
  todayCollectedSince: string | null;
  /** `Clinic.paymentsTrackedSince` is set. */
  paymentsTracked: boolean;
  /** The first Tashkent day with all its payments in the CRM; null if none. */
  measuredFrom: string | null;
  /** Month-to-date totals (from the 1st through `now`). */
  mtd: {
    /**
     * Collected from `collectedFrom` through today; null when no fully
     * recorded day of this month has started yet.
     */
    revenueCollectedTiins: number | null;
    /**
     * First day summed: the 1st, or `measuredFrom` when recording began
     * this month (then it is not a month-to-date and there is no forecast).
     */
    collectedFrom: string | null;
    revenueScheduledTiins: number;
    noShowLossTiins: number;
  };
  /**
   * Naive linear forecast: MTD-collected scaled to full month. Null unless
   * the whole month so far is recorded: a part of the month scaled by
   * days-in-month over day-of-month is not a forecast.
   */
  forecastMonthEndTiins: number | null;
  daily: FinancialDailyPoint[];
  /**
   * First day the collected trend draws: the window's start, or
   * `measuredFrom` when that is later. Null when payments are not recorded.
   */
  trendFrom: string | null;
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

/**
 * The first Tashkent day whose payments are all in the CRM: the day
 * recording was switched on when that happened at its midnight, else the
 * next one. The settings switch stamps the moment it is turned on, so the
 * morning before it is not recorded.
 */
export function firstFullyRecordedDay(trackedSince: Date | null): string | null {
  if (!trackedSince) return null;
  const key = tashkentDateOf(trackedSince);
  const { dayStart } = tashkentDayBoundsForDateString(key);
  return trackedSince.getTime() <= dayStart.getTime() ? key : addTashkentDays(key, 1);
}

/** Pure: the snapshot from the MV rows of the window. */
export function buildFinancialSnapshot(input: {
  rows: ReadonlyArray<RawDayRow>;
  window: FinancialWindow;
  todayCollectedLiveTiins: number | null;
  /** `Clinic.paymentsTrackedSince`. */
  trackedSince: Date | null;
  now: Date;
}): FinancialPaceSnapshot {
  const { window } = input;
  const measuredFrom = firstFullyRecordedDay(input.trackedSince);
  // Day keys compare as strings.
  const collectedFrom =
    measuredFrom === null
      ? null
      : measuredFrom > window.monthStart
        ? measuredFrom
        : window.monthStart;
  const hasMtd = collectedFrom !== null && collectedFrom <= window.todayKey;
  let today: FinancialDailyPoint | null = null;
  const daily: FinancialDailyPoint[] = [];
  let mtdCollected = 0;
  let mtdScheduled = 0;
  let mtdNoShowLoss = 0;
  let refreshedAt: number | null = null;
  for (const r of input.rows) {
    const key = dayKeyOf(r.day);
    const recorded = measuredFrom !== null && key >= measuredFrom;
    const point: FinancialDailyPoint = {
      day: key,
      revenueCollectedTiins: recorded ? Number(r.revenueCollectedTiins) : null,
      revenueScheduledTiins: Number(r.revenueScheduledTiins),
      noShowLossTiins: Number(r.noShowLossTiins),
    };
    if (recorded && key === window.todayKey && input.todayCollectedLiveTiins !== null) {
      // The live figure replaces the hour-old one, in the trend too.
      point.revenueCollectedTiins = input.todayCollectedLiveTiins;
    }
    daily.push(point);
    if (key === window.todayKey) today = point;
    if (key >= window.monthStart && key < window.nextMonthStart) {
      if (hasMtd && key >= (collectedFrom as string)) {
        mtdCollected += point.revenueCollectedTiins ?? 0;
      }
      mtdScheduled += point.revenueScheduledTiins;
      mtdNoShowLoss += point.noShowLossTiins;
    }
    if (r.refreshedAt) {
      const ms = new Date(r.refreshedAt).getTime();
      if (Number.isFinite(ms) && (refreshedAt === null || ms > refreshedAt)) refreshedAt = ms;
    }
  }

  // Forecast: MTD-collected scaled to the month's length on the Tashkent
  // day of `todayKey`, the client card's formula. Only from the 1st.
  const forecastMonthEndTiins =
    hasMtd && collectedFrom === window.monthStart
      ? projectMonthEnd(mtdCollected, new Date(`${window.todayKey}T12:00:00+05:00`))
          .projectedTiins
      : null;

  // Switched on today after midnight: today's figure is from that moment.
  const since = input.trackedSince;
  const todayCollectedSince =
    since !== null &&
    input.todayCollectedLiveTiins !== null &&
    measuredFrom !== null &&
    measuredFrom > window.todayKey &&
    tashkentDateOf(since) === window.todayKey
      ? since.toISOString()
      : null;

  return {
    today,
    todayKey: window.todayKey,
    todayCollectedLiveTiins: input.todayCollectedLiveTiins,
    todayCollectedSince,
    paymentsTracked: input.trackedSince !== null,
    measuredFrom,
    mtd: {
      revenueCollectedTiins: hasMtd ? mtdCollected : null,
      collectedFrom: hasMtd ? collectedFrom : null,
      revenueScheduledTiins: mtdScheduled,
      noShowLossTiins: mtdNoShowLoss,
    },
    forecastMonthEndTiins,
    daily,
    trendFrom:
      measuredFrom === null ? null : measuredFrom > window.from ? measuredFrom : window.from,
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
  let todayCollectedLiveTiins: number | null = null;
  if (trackedSince !== null) {
    const { dayStart, dayEnd } = tashkentDayBoundsForDateString(window.todayKey);
    // On the day recording is switched on, count from the switch: the
    // morning before it is not recorded (the card then says from when).
    const from = trackedSince > dayStart ? trackedSince : dayStart;
    // Net of today's refunds, the same rule as the view (audit AN-11).
    todayCollectedLiveTiins = await sumNetRevenue(
      prisma as never,
      { from, to: dayEnd },
      { clinicId },
    );
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
    trackedSince,
    now,
  });
}
