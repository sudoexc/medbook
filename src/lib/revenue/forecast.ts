/**
 * Pure helpers for the Revenue Forecast dashboard (Phase 14, Wave 3).
 *
 * The forecast page shows a 30-day forward revenue projection with
 * confidence bands and what-if sliders. The math is split into pure helpers
 * here so it can be unit-tested without DB access AND so the client-side
 * sliders can re-apply the same transform on every drag without a
 * round-trip to the server.
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
  /** 0..50 — percentage points of no-show rate to remove. */
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
 * Apply what-if sliders to a baseline forecast. Returns a new array with
 * each `{low, baseline, high}` adjusted in-place by the slider deltas:
 *
 *   1. Reducing no-show lifts the low band toward baseline (low += (mid-low) * f)
 *   2. Filling empty slots lifts the high band further (high += (high-mid) * f)
 *   3. Price uplift multiplies all three bands uniformly
 *
 * The transform is pure — same input always yields same output. All three
 * sliders at 0 returns the original `points` shallow-cloned (we never
 * mutate the input, so the caller can keep the baseline reference).
 *
 * Negative low bands are clamped at 0 (revenue is non-negative).
 *
 * Result invariants:
 *   - low <= baseline <= high (always)
 *   - all numbers are integers (tiins) — `Math.round` per band per day
 */
export function applyWhatIfSliders(
  points: ReadonlyArray<ForecastPoint>,
  sliders: Partial<WhatIfSliders>,
): ForecastPoint[] {
  const s = clampSliders(sliders);
  const reduceFactor = s.reduceNoShowPct / 100; // 0..0.5
  const fillFactor = s.fillEmptyPct / 100; // 0..0.5
  const priceMult = 1 + s.priceUpliftPct / 100; // 1..1.3

  return points.map((p) => {
    const lowGap = p.baseline - p.low;
    const highGap = p.high - p.baseline;
    const adjustedLow = p.low + lowGap * reduceFactor;
    const adjustedHigh = p.high + highGap * fillFactor;
    const adjustedBaseline = p.baseline;

    // Apply price uplift uniformly across the band.
    const newLow = Math.max(0, Math.round(adjustedLow * priceMult));
    const newBaseline = Math.max(0, Math.round(adjustedBaseline * priceMult));
    const newHigh = Math.max(0, Math.round(adjustedHigh * priceMult));

    // Defensive sort — `lowGap` and `highGap` are non-negative by
    // construction (callers build bands with low<=baseline<=high) but if
    // an upstream bug ever flips them, we don't want a non-monotonic chart.
    const sorted = [newLow, newBaseline, newHigh].sort((a, b) => a - b);

    return {
      date: p.date,
      low: sorted[0]!,
      baseline: sorted[1]!,
      high: sorted[2]!,
    };
  });
}

/**
 * Sum the high-band over the forecast horizon. This is the "Achievable
 * revenue ceiling" KPI — what the clinic could earn if every slider were
 * cranked to its max AND the optimistic assumptions held.
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
