/**
 * Server-side forecast loader for /crm/analytics/forecast.
 *
 * Measures each of the next 30 days (audit AN-21); the band and the
 * what-if sliders are projected from these by `projectForecast`, on the
 * server for the first paint and in the browser on every slider move:
 *
 *   bookedUzs[d]    = sum(Appointment.priceFinal | priceBase | clinicAvg)
 *                     for visits on day d still in the pipeline
 *                     (`ACTIVE_VISIT_STATUSES`)
 *   emptySlotUzs[d] = the average `EmptySlotSnapshot` loss of d's weekday
 *                     over the last 4 weeks (what usually stays empty)
 *   noShowRate      = NO_SHOW / (COMPLETED + NO_SHOW) over the last 30
 *                     days, the resolved visits (the no-show rate's
 *                     denominator everywhere since AN-07)
 *
 * The empty-slot uplift used to be a constant 5% and the no-show rate was
 * counted over every booking, cancelled ones included. Either input can be
 * missing (no resolved visits, no snapshots): it is null / flagged, and the
 * page disables the slider it would drive instead of showing a lever that
 * moves nothing.
 */
import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { ACTIVE_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import {
  projectForecast,
  type ForecastDay,
  type ForecastPoint,
} from "@/lib/revenue/forecast";
import { toDateKey } from "@/lib/revenue/loss-aggregation";

export interface ForecastDashboardData {
  /** 30 forward days starting at today (Tashkent clinic day). */
  days: ForecastDay[];
  /** `days` projected with the sliders at zero. */
  points: ForecastPoint[];
  meta: {
    /** 0..1, null when no visit resolved in the last 30 days. */
    historicalNoShowRate: number | null;
    /** False when no empty-slot snapshot exists in the last 4 weeks. */
    emptySlotDataAvailable: boolean;
    /** Average empty-slot loss per week over the snapshot window, tiins. */
    emptySlotWeeklyUzs: number;
    averageServicePriceUzs: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_DAYS = 30;
const LOOKBACK_DAYS_NOSHOW = 30;
const LOOKBACK_DAYS_EMPTY = 28;

/** Sun=0..Sat=6 of a Tashkent "YYYY-MM-DD" day. */
function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/**
 * Average empty-slot loss per weekday from snapshot rows. Each weekday is
 * averaged over its occurrences from the first snapshot day up to (not
 * including) `todayKey`: a fully booked day writes no rows and must count
 * as 0, while days before the engine ever ran must not count at all.
 */
export function emptySlotByWeekday(
  rows: ReadonlyArray<{ date: Date; estimatedRevenueLossUzs: number }>,
  todayKey: string,
): { byWeekday: number[]; weeklyUzs: number; available: boolean } {
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  if (rows.length === 0) return { byWeekday, weeklyUzs: 0, available: false };
  const sums = [0, 0, 0, 0, 0, 0, 0];
  let firstKey = todayKey;
  for (const r of rows) {
    const key = toDateKey(r.date);
    if (key >= todayKey) continue;
    if (key < firstKey) firstKey = key;
    sums[weekdayOf(key)]! += Math.max(0, r.estimatedRevenueLossUzs);
  }
  if (firstKey >= todayKey) return { byWeekday, weeklyUzs: 0, available: false };
  const occurrences = [0, 0, 0, 0, 0, 0, 0];
  let total = 0;
  let dayCount = 0;
  for (
    let ms = Date.parse(`${firstKey}T00:00:00Z`);
    ms < Date.parse(`${todayKey}T00:00:00Z`);
    ms += DAY_MS
  ) {
    occurrences[new Date(ms).getUTCDay()]! += 1;
    dayCount += 1;
  }
  for (let w = 0; w < 7; w += 1) {
    byWeekday[w] = occurrences[w]! > 0 ? Math.round(sums[w]! / occurrences[w]!) : 0;
    total += sums[w]!;
  }
  return {
    byWeekday,
    weeklyUzs: dayCount > 0 ? Math.round((total * 7) / dayCount) : 0,
    available: true,
  };
}

export async function loadForecast(
  clinicId: string,
  now: Date = new Date(),
): Promise<ForecastDashboardData> {
  // Clinic day (Asia/Tashkent, no DST) — 24h steps stay on clinic midnights.
  const todayMidnight = tashkentDayBounds(now).dayStart;
  const horizon = new Date(todayMidnight.getTime() + FORECAST_DAYS * DAY_MS);

  // 1. Current booked pipeline — scheduled in `[today, today+30d)`.
  // CONFIRMED is the surest part of it (audit AN-22): phone bookings are
  // created CONFIRMED and a patient's «Подтверждаю» moves a booking there,
  // so the forecast used to drop exactly when the call center did its job.
  const upcoming = await prisma.appointment.findMany({
    where: {
      clinicId,
      date: { gte: todayMidnight, lt: horizon },
      status: { in: [...ACTIVE_VISIT_STATUSES] },
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

  // 2. Historical no-show rate over the resolved visits of the last 30 days.
  const noShowFrom = new Date(todayMidnight.getTime() - LOOKBACK_DAYS_NOSHOW * DAY_MS);
  const recentResolved = await prisma.appointment.count({
    where: {
      clinicId,
      date: { gte: noShowFrom, lt: todayMidnight },
      status: { in: ["COMPLETED", "NO_SHOW"] },
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
    recentResolved > 0 ? recentNoShow / recentResolved : null;

  // 3. What usually stays empty, per weekday, from the snapshot engine.
  const emptyFrom = new Date(todayMidnight.getTime() - LOOKBACK_DAYS_EMPTY * DAY_MS);
  const snapshots = await prisma.emptySlotSnapshot.findMany({
    where: { clinicId, date: { gte: emptyFrom, lt: todayMidnight } },
    select: { date: true, estimatedRevenueLossUzs: true },
  });
  const empty = emptySlotByWeekday(snapshots, toDateKey(todayMidnight));

  // 4. Bucket upcoming revenue per day.
  const bookedPerDay = new Map<string, number>();
  for (const a of upcoming) {
    const key = toDateKey(a.date);
    const valueUzs =
      a.priceFinal && a.priceFinal > 0
        ? a.priceFinal
        : a.primaryService?.priceBase && a.primaryService.priceBase > 0
          ? a.primaryService.priceBase
          : averageServicePriceUzs;
    if (valueUzs <= 0) continue;
    bookedPerDay.set(key, (bookedPerDay.get(key) ?? 0) + valueUzs);
  }

  // 5. Every day in the window (including zero days).
  const days: ForecastDay[] = [];
  for (let i = 0; i < FORECAST_DAYS; i += 1) {
    const key = toDateKey(new Date(todayMidnight.getTime() + i * DAY_MS));
    days.push({
      date: key,
      bookedUzs: bookedPerDay.get(key) ?? 0,
      emptySlotUzs: empty.byWeekday[weekdayOf(key)] ?? 0,
    });
  }

  return {
    days,
    points: projectForecast(days, historicalNoShowRate, {}),
    meta: {
      historicalNoShowRate,
      emptySlotDataAvailable: empty.available,
      emptySlotWeeklyUzs: empty.weeklyUzs,
      averageServicePriceUzs,
    },
  };
}
