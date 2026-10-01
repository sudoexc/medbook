/**
 * Pure helpers for the Revenue Forecast dashboard (Phase 14, Wave 3).
 *
 * The forecast page shows a 30-day forward revenue projection with a band
 * and what-if sliders. The math is split into pure helpers here so it can
 * be unit-tested without DB access AND so the client-side sliders can
 * re-project on every drag without a round-trip to the server.
 *
 * Money units: every UZS amount is in **tiins** (minor units).
 *
 * Pure: zero imports.
 */

export interface ForecastPoint {
  /** "YYYY-MM-DD" — one entry per forecast day. */
  date: string;
  /** Lower-band projection in tiins. */
  low: number;
  /** Mid baseline projection in tiins. */
  baseline: number;
  /** Upper-band projection in tiins. */
  high: number;
}

export interface WhatIfSliders {
  /** 0..50 — percent fewer no-shows (relative to the historical rate). */
  reduceNoShowPct: number;
  /** 0..50 — percentage of empty slots that get filled. */
  fillEmptyPct: number;
  /** 0..30 — average price uplift across all visits. */
  priceUpliftPct: number;
}

/**
 * Clamp a slider value to its allowed range. Sliders default to 0 (the
 * untouched baseline) — out-of-range values are coerced into bounds rather
 * than throwing, since they may arrive from URL state or stale localStorage.
 */
export function clampSliders(s: Partial<WhatIfSliders>): WhatIfSliders {
  return {
    reduceNoShowPct: clamp(s.reduceNoShowPct ?? 0, 0, 50),
    fillEmptyPct: clamp(s.fillEmptyPct ?? 0, 0, 50),
    priceUpliftPct: clamp(s.priceUpliftPct ?? 0, 0, 30),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * One forecast day as the server measured it. The client re-projects these
 * on every slider move (`projectForecast`), so the sliders work on real
 * quantities instead of reshaping a finished band.
 */
export interface ForecastDay {
  /** "YYYY-MM-DD", the Tashkent clinic day. */
  date: string;
  /** Visits booked for the day at their price, tiins: everyone shows up. */
  bookedUzs: number;
  /**
   * What typically stays empty on this weekday, tiins: the average of the
   * recent `EmptySlotSnapshot` losses for the same weekday. 0 without
   * snapshots.
   */
  emptySlotUzs: number;
}

/**
 * Project the forecast band from the measured days (audit AN-21).
 *
 * The sliders used to reshape a finished band: «снизить неявки» only lifted
 * the low edge and «заполнить пустые слоты» only the high one, while the
 * KPIs read the untouched middle line; 50% of empty slots meant +2.5%
 * because the ceiling was a constant baseline × 1.05. Now every slider
 * moves the expected revenue through what it acts on:
 *
 *   r      = historical no-show rate, cut by `reduceNoShowPct` (relative:
 *            30% means 30% fewer no-shows)
 *   filled = emptySlotUzs × fillEmptyPct
 *   low      = bookedUzs × (1 − r)            booked visits, usual no-shows
 *   baseline = (bookedUzs + filled) × (1 − r) plus the slots filled
 *   high     = bookedUzs + filled             nobody fails to show
 *   all × (1 + priceUpliftPct)
 *
 * So the adjusted forecast rises by `booked × r × reduce` for fewer
 * no-shows, in proportion to the historical rate, and by the real empty
 * value for filled slots. Integers (tiins), never negative,
 * low <= baseline <= high.
 */
export function projectForecast(
  days: ReadonlyArray<ForecastDay>,
  historicalNoShowRate: number | null,
  sliders: Partial<WhatIfSliders>,
): ForecastPoint[] {
  const s = clampSliders(sliders);
  const rate = clamp(historicalNoShowRate ?? 0, 0, 1);
  const noShow = rate * (1 - s.reduceNoShowPct / 100);
  const show = 1 - noShow;
  const fill = s.fillEmptyPct / 100;
  const priceMult = 1 + s.priceUpliftPct / 100;
  return days.map((d) => {
    const booked = Math.max(0, d.bookedUzs);
    const filled = Math.max(0, d.emptySlotUzs) * fill;
    return {
      date: d.date,
      low: Math.round(booked * show * priceMult),
      baseline: Math.round((booked + filled) * show * priceMult),
      high: Math.round((booked + filled) * priceMult),
    };
  });
}

/**
 * Sum the high band over the forecast horizon: the «Потолок выручки» KPI,
 * what the scenario earns if nobody fails to show.
 */
export function ceilingRevenue(points: ReadonlyArray<ForecastPoint>): number {
  let sum = 0;
  for (const p of points) sum += Math.max(0, Math.round(p.high));
  return sum;
}

/** Sum the baseline projection. */
export function baselineRevenue(points: ReadonlyArray<ForecastPoint>): number {
  let sum = 0;
  for (const p of points) sum += Math.max(0, Math.round(p.baseline));
  return sum;
}

/**
 * Difference between an adjusted forecast's baseline and the original
 * baseline — i.e. "delta from sliders" for a banner KPI. Negative means
 * the sliders pessimised the projection (shouldn't happen with positive
 * slider values, but the function tolerates arbitrary point arrays).
 */
export function projectedDelta(
  baseline: ReadonlyArray<ForecastPoint>,
  adjusted: ReadonlyArray<ForecastPoint>,
): number {
  return baselineRevenue(adjusted) - baselineRevenue(baseline);
}
