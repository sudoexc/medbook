/**
 * Unit tests — Phase 14, Wave 3.
 *
 * Pure-function coverage for the forecast and loss-aggregation helpers in
 * `src/lib/revenue/`. These power the /crm/analytics/loss and /forecast
 * dashboards; the page components themselves are exempt from tests (too
 * fragile, low value).
 */
import { describe, it, expect } from "vitest";

import {
  baselineRevenue,
  ceilingRevenue,
  clampSliders,
  projectForecast,
  projectedDelta,
  type ForecastDay,
  type ForecastPoint,
} from "@/lib/revenue/forecast";
import {
  aggregateDaily,
  aggregateLoss,
  eachDateKey,
  estimateAverageVisitValue,
  isLateCancellation,
  toDateKey,
  type LossEntry,
} from "@/lib/revenue/loss-aggregation";

// -----------------------------------------------------------------------------
// Forecast — sliders and KPI sums
// -----------------------------------------------------------------------------

const baselinePoints: ForecastPoint[] = [
  { date: "2026-05-06", low: 800_000_00, baseline: 1_000_000_00, high: 1_200_000_00 },
  { date: "2026-05-07", low: 600_000_00, baseline: 750_000_00, high: 900_000_00 },
  { date: "2026-05-08", low: 0, baseline: 0, high: 0 },
];

describe("clampSliders", () => {
  it("defaults missing fields to 0", () => {
    expect(clampSliders({})).toEqual({
      reduceNoShowPct: 0,
      fillEmptyPct: 0,
      priceUpliftPct: 0,
    });
  });

  it("clamps each slider to its allowed range", () => {
    const s = clampSliders({
      reduceNoShowPct: 999,
      fillEmptyPct: -50,
      priceUpliftPct: 100,
    });
    expect(s.reduceNoShowPct).toBe(50);
    expect(s.fillEmptyPct).toBe(0);
    expect(s.priceUpliftPct).toBe(30);
  });

  it("treats non-finite values as 0", () => {
    const s = clampSliders({ reduceNoShowPct: NaN, priceUpliftPct: Infinity });
    expect(s.reduceNoShowPct).toBe(0);
    expect(s.priceUpliftPct).toBe(0);
  });
});

// projectForecast replaced applyWhatIfSliders (audit AN-21): the sliders act
// on measured quantities. The behaviour is pinned in
// an14-an26-analytics-dates-exports.test.ts; the invariants stay here.
const forecastDays: ForecastDay[] = [
  { date: "2026-05-06", bookedUzs: 1_000_000_00, emptySlotUzs: 400_000_00 },
  { date: "2026-05-07", bookedUzs: 750_000_00, emptySlotUzs: 0 },
  { date: "2026-05-08", bookedUzs: 0, emptySlotUzs: 0 },
];

describe("projectForecast", () => {
  it("does not mutate the input", () => {
    const snapshot = JSON.parse(JSON.stringify(forecastDays));
    projectForecast(forecastDays, 0.2, {
      reduceNoShowPct: 50,
      fillEmptyPct: 50,
      priceUpliftPct: 30,
    });
    expect(forecastDays).toEqual(snapshot);
  });

  it("max sliders never produce negative bands", () => {
    const out = projectForecast(forecastDays, 0.2, {
      reduceNoShowPct: 50,
      fillEmptyPct: 50,
      priceUpliftPct: 30,
    });
    for (const p of out) {
      expect(p.low).toBeGreaterThanOrEqual(0);
      expect(p.baseline).toBeGreaterThanOrEqual(0);
      expect(p.high).toBeGreaterThanOrEqual(0);
    }
  });

  it("preserves low <= baseline <= high", () => {
    const out = projectForecast(forecastDays, 0.25, {
      reduceNoShowPct: 35,
      fillEmptyPct: 25,
      priceUpliftPct: 15,
    });
    for (const p of out) {
      expect(p.low).toBeLessThanOrEqual(p.baseline);
      expect(p.baseline).toBeLessThanOrEqual(p.high);
    }
  });

  it("price uplift multiplies every band uniformly", () => {
    const out = projectForecast(
      [{ date: "d", bookedUzs: 200, emptySlotUzs: 0 }],
      0.5,
      { priceUpliftPct: 10 },
    );
    expect(out[0]).toEqual({ date: "d", low: 110, baseline: 110, high: 220 });
  });

  it("zero-booked day stays zero", () => {
    const out = projectForecast(
      [{ date: "d", bookedUzs: 0, emptySlotUzs: 0 }],
      0.3,
      { reduceNoShowPct: 50, fillEmptyPct: 50, priceUpliftPct: 30 },
    );
    expect(out[0]!).toEqual({ date: "d", low: 0, baseline: 0, high: 0 });
  });
});

describe("ceilingRevenue / baselineRevenue / projectedDelta", () => {
  it("ceiling = sum of high-band; baseline = sum of mid-band", () => {
    expect(ceilingRevenue(baselinePoints)).toBe(
      1_200_000_00 + 900_000_00 + 0,
    );
    expect(baselineRevenue(baselinePoints)).toBe(
      1_000_000_00 + 750_000_00 + 0,
    );
  });

  it("delta is 0 against itself", () => {
    expect(projectedDelta(baselinePoints, baselinePoints)).toBe(0);
  });

  it("delta is positive after a price uplift", () => {
    const base = projectForecast(forecastDays, 0.2, {});
    const adjusted = projectForecast(forecastDays, 0.2, {
      reduceNoShowPct: 0,
      fillEmptyPct: 0,
      priceUpliftPct: 10,
    });
    expect(projectedDelta(base, adjusted)).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// Loss aggregation
// -----------------------------------------------------------------------------

describe("toDateKey / eachDateKey", () => {
  it("keys by the Tashkent (clinic) civil day", () => {
    // Tashkent midnight = 19:00Z of the previous UTC day.
    expect(toDateKey(new Date("2026-05-05T19:00:00.000Z"))).toBe("2026-05-06");
    expect(toDateKey(new Date("2026-05-06T00:00:00.000Z"))).toBe("2026-05-06");
    // 20:30Z = 01:30 Tashkent of May 7 — belongs to the next clinic day.
    expect(toDateKey(new Date("2026-05-06T20:30:00.000Z"))).toBe("2026-05-07");
  });

  it("eachDateKey returns inclusive..exclusive range", () => {
    expect(eachDateKey("2026-05-06", "2026-05-09")).toEqual([
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
    ]);
  });

  it("eachDateKey handles month boundaries", () => {
    const days = eachDateKey("2026-04-29", "2026-05-02");
    expect(days).toEqual(["2026-04-29", "2026-04-30", "2026-05-01"]);
  });

  it("eachDateKey returns [] when from >= to", () => {
    expect(eachDateKey("2026-05-06", "2026-05-06")).toEqual([]);
    expect(eachDateKey("2026-05-10", "2026-05-06")).toEqual([]);
  });
});

describe("aggregateLoss", () => {
  it("empty entries → 0 totals", () => {
    const t = aggregateLoss([], "2026-05-06", "2026-05-13");
    expect(t).toEqual({
      emptySlot: 0,
      noShow: 0,
      cancellation: 0,
      total: 0,
    });
  });

  it("single source aggregates to its own bucket only", () => {
    const entries: LossEntry[] = [
      { dateKey: "2026-05-06", source: "emptySlot", amountUzs: 50_000_00 },
      { dateKey: "2026-05-07", source: "emptySlot", amountUzs: 25_000_00 },
    ];
    const t = aggregateLoss(entries, "2026-05-06", "2026-05-13");
    expect(t.emptySlot).toBe(75_000_00);
    expect(t.noShow).toBe(0);
    expect(t.cancellation).toBe(0);
    expect(t.total).toBe(75_000_00);
  });

  it("multi-source totals stack correctly", () => {
    const entries: LossEntry[] = [
      { dateKey: "2026-05-06", source: "emptySlot", amountUzs: 100 },
      { dateKey: "2026-05-06", source: "noShow", amountUzs: 200 },
      { dateKey: "2026-05-07", source: "cancellation", amountUzs: 300 },
    ];
    const t = aggregateLoss(entries, "2026-05-06", "2026-05-13");
    expect(t.emptySlot).toBe(100);
    expect(t.noShow).toBe(200);
    expect(t.cancellation).toBe(300);
    expect(t.total).toBe(600);
  });

  it("excludes entries before fromKey", () => {
    const entries: LossEntry[] = [
      { dateKey: "2026-05-05", source: "emptySlot", amountUzs: 999 },
      { dateKey: "2026-05-06", source: "emptySlot", amountUzs: 100 },
    ];
    const t = aggregateLoss(entries, "2026-05-06", "2026-05-13");
    expect(t.emptySlot).toBe(100);
  });

  it("excludes entries on/after toKeyExcl (exclusive)", () => {
    const entries: LossEntry[] = [
      { dateKey: "2026-05-12", source: "noShow", amountUzs: 100 },
      { dateKey: "2026-05-13", source: "noShow", amountUzs: 999 },
    ];
    const t = aggregateLoss(entries, "2026-05-06", "2026-05-13");
    expect(t.noShow).toBe(100);
  });

  it("clamps negative amounts to 0", () => {
    const entries: LossEntry[] = [
      { dateKey: "2026-05-06", source: "noShow", amountUzs: -100 },
      { dateKey: "2026-05-06", source: "noShow", amountUzs: 50 },
    ];
    const t = aggregateLoss(entries, "2026-05-06", "2026-05-07");
    expect(t.noShow).toBe(50);
    expect(t.total).toBe(50);
  });
});

describe("aggregateDaily", () => {
  it("returns a row per day even if no entries that day", () => {
    const out = aggregateDaily([], "2026-05-06", "2026-05-09");
    expect(out).toEqual([
      { date: "2026-05-06", emptySlot: 0, noShow: 0, cancellation: 0 },
      { date: "2026-05-07", emptySlot: 0, noShow: 0, cancellation: 0 },
      { date: "2026-05-08", emptySlot: 0, noShow: 0, cancellation: 0 },
    ]);
  });

  it("groups multiple entries on the same date", () => {
    const entries: LossEntry[] = [
      { dateKey: "2026-05-06", source: "emptySlot", amountUzs: 100 },
      { dateKey: "2026-05-06", source: "emptySlot", amountUzs: 250 },
      { dateKey: "2026-05-06", source: "noShow", amountUzs: 50 },
      { dateKey: "2026-05-07", source: "cancellation", amountUzs: 99 },
    ];
    const out = aggregateDaily(entries, "2026-05-06", "2026-05-08");
    expect(out[0]).toEqual({
      date: "2026-05-06",
      emptySlot: 350,
      noShow: 50,
      cancellation: 0,
    });
    expect(out[1]).toEqual({
      date: "2026-05-07",
      emptySlot: 0,
      noShow: 0,
      cancellation: 99,
    });
  });

  it("ignores entries outside the window", () => {
    const entries: LossEntry[] = [
      { dateKey: "2026-04-01", source: "emptySlot", amountUzs: 9999 },
      { dateKey: "2026-06-01", source: "emptySlot", amountUzs: 9999 },
    ];
    const out = aggregateDaily(entries, "2026-05-06", "2026-05-08");
    expect(out.every((p) => p.emptySlot === 0)).toBe(true);
  });
});

describe("estimateAverageVisitValue", () => {
  it("returns 0 when payments are 0", () => {
    expect(
      estimateAverageVisitValue({ totalPaymentsUzs: 0, activePatientCount: 50 }),
    ).toBe(0);
  });

  it("rounds to nearest tiin", () => {
    expect(
      estimateAverageVisitValue({ totalPaymentsUzs: 100, activePatientCount: 3 }),
    ).toBe(33);
  });

  it("uses 1 as a divisor floor (no division by zero)", () => {
    expect(
      estimateAverageVisitValue({ totalPaymentsUzs: 500, activePatientCount: 0 }),
    ).toBe(500);
  });

  it("clamps negative inputs to 0", () => {
    expect(
      estimateAverageVisitValue({ totalPaymentsUzs: -100, activePatientCount: 5 }),
    ).toBe(0);
  });
});

describe("isLateCancellation", () => {
  const start = new Date("2026-05-10T12:00:00.000Z");

  it("null cancelledAt is never late", () => {
    expect(isLateCancellation({ startsAt: start, cancelledAt: null })).toBe(false);
  });

  it("cancellation 25h before start is NOT late", () => {
    const cancelledAt = new Date(start.getTime() - 25 * 60 * 60 * 1000);
    expect(isLateCancellation({ startsAt: start, cancelledAt })).toBe(false);
  });

  it("cancellation 23h before start IS late", () => {
    const cancelledAt = new Date(start.getTime() - 23 * 60 * 60 * 1000);
    expect(isLateCancellation({ startsAt: start, cancelledAt })).toBe(true);
  });

  it("cancellation right at 24h boundary IS late (inclusive)", () => {
    const cancelledAt = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    expect(isLateCancellation({ startsAt: start, cancelledAt })).toBe(true);
  });

  it("cancellation after start IS late (no-show in disguise)", () => {
    const cancelledAt = new Date(start.getTime() + 60 * 60 * 1000);
    expect(isLateCancellation({ startsAt: start, cancelledAt })).toBe(true);
  });
});
