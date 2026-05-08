/**
 * Server-side forecast loader for /crm/analytics/forecast.
 *
 * Builds a 30-day forward `ForecastPoint[]` from the current booked
 * pipeline plus historical signal:
 *
 *   baseline[d] = sum(Appointment.priceFinal | priceBase | clinicAvg) for
 *                  appointments scheduled on day d, status BOOKED|WAITING|
 *                  IN_PROGRESS (the still-open pipeline)
 *   low[d]      = baseline × (1 − historicalNoShowRate)
 *   high[d]     = baseline × (1 + emptySlotFillUplift)
 *
 * The historical no-show rate is computed over the last 30 days. The
 * empty-slot uplift is a rough estimate: of all empty hours snapshot-
 * recorded in the last 14 days, how many got filled within 3 days of the
 * snapshot (we don't track this directly so we approximate as a small
 * constant 5% bump). Wave 4 can replace this with a real attribution.
 */
import { prisma } from "@/lib/prisma";
import type { ForecastPoint } from "@/lib/revenue/forecast";
import { toDateKey } from "@/lib/revenue/loss-aggregation";

export interface ForecastDashboardData {
  /** 30 forward-day points starting at today (UTC). */
  points: ForecastPoint[];
  /** Used by the page to show how the bands were derived. */
  meta: {
    historicalNoShowRate: number; // 0..1
    emptySlotUpliftRate: number; // 0..0.5 (currently constant 0.05)
    averageServicePriceUzs: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_DAYS = 30;
const LOOKBACK_DAYS_NOSHOW = 30;

function utcMidnight(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}

export async function loadForecast(
  clinicId: string,
  now: Date = new Date(),
): Promise<ForecastDashboardData> {
  const todayMidnight = utcMidnight(now);
  const horizon = new Date(todayMidnight.getTime() + FORECAST_DAYS * DAY_MS);

  // 1. Current booked pipeline — scheduled in `[today, today+30d)`.
  const upcoming = await prisma.appointment.findMany({
    where: {
      clinicId,
      date: { gte: todayMidnight, lt: horizon },
      status: { in: ["BOOKED", "WAITING", "IN_PROGRESS"] },
    },
    select: {
      date: true,
      priceFinal: true,
      primaryService: { select: { priceBase: true } },
    },
  });

  // Clinic-average fallback price.
  const services = await prisma.service.findMany({
    where: { clinicId, isActive: true },
    select: { priceBase: true },
  });
  const averageServicePriceUzs =
    services.length > 0
      ? Math.round(
          services.reduce((acc, s) => acc + s.priceBase, 0) / services.length,
        )
      : 0;

  // 2. Historical no-show rate — last 30 days.
  const noShowFrom = new Date(todayMidnight.getTime() - LOOKBACK_DAYS_NOSHOW * DAY_MS);
  const recentTotal = await prisma.appointment.count({
    where: {
      clinicId,
      date: { gte: noShowFrom, lt: todayMidnight },
    },
  });
  const recentNoShow = await prisma.appointment.count({
    where: {
      clinicId,
      date: { gte: noShowFrom, lt: todayMidnight },
      status: "NO_SHOW",
    },
  });
  const historicalNoShowRate =
    recentTotal > 0 ? recentNoShow / recentTotal : 0;

  // 3. Empty-slot uplift — currently a small constant. The empty-slot
  // engine doesn't yet record fill outcomes, so this is the fastest
  // honest estimate: assume ~5% of currently-empty hours close late.
  // Wave 4 / Phase 17 can wire a real attribution loop.
  const emptySlotUpliftRate = 0.05;

  // 4. Bucket upcoming revenue per day.
  const baselinePerDay = new Map<string, number>();
  for (const a of upcoming) {
    const key = toDateKey(utcMidnight(a.date));
    const valueUzs =
      a.priceFinal && a.priceFinal > 0
        ? a.priceFinal
        : a.primaryService?.priceBase && a.primaryService.priceBase > 0
          ? a.primaryService.priceBase
          : averageServicePriceUzs;
    if (valueUzs <= 0) continue;
    baselinePerDay.set(key, (baselinePerDay.get(key) ?? 0) + valueUzs);
  }

  // 5. Build points for every day in the window (including zero days).
  const points: ForecastPoint[] = [];
  for (let i = 0; i < FORECAST_DAYS; i += 1) {
    const day = new Date(todayMidnight.getTime() + i * DAY_MS);
    const key = toDateKey(day);
    const baseline = baselinePerDay.get(key) ?? 0;
    const low = Math.round(baseline * (1 - historicalNoShowRate));
    const high = Math.round(baseline * (1 + emptySlotUpliftRate));
    points.push({
      date: key,
      low: Math.max(0, low),
      baseline: Math.max(0, baseline),
      high: Math.max(0, high),
    });
  }

  return {
    points,
    meta: {
      historicalNoShowRate,
      emptySlotUpliftRate,
      averageServicePriceUzs,
    },
  };
}
