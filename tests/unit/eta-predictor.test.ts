/**
 * Phase 10 — `predictETA` unit coverage.
 *
 * Exercises the three sample-size bands, blending math, [5, 240] clamp, and
 * the round-to-nearest-5 quantization.
 */
import { describe, it, expect } from "vitest";

import { predictETA, type HistoricalSample } from "@/lib/ai/eta-predictor";

function sample(durationMin: number, baseEpoch = 1_700_000_000_000): HistoricalSample {
  return {
    startedAt: new Date(baseEpoch),
    completedAt: new Date(baseEpoch + durationMin * 60_000),
  };
}

function manySamples(durations: number[]): HistoricalSample[] {
  let t = 1_700_000_000_000;
  const out: HistoricalSample[] = [];
  for (const d of durations) {
    out.push(sample(d, t));
    t += d * 60_000 + 1_000;
  }
  return out;
}

describe("predictETA", () => {
  it("empty history → fallback only, low confidence", () => {
    const r = predictETA({ history: [], fallbackMin: 30 });
    expect(r.sampleSize).toBe(0);
    expect(r.source).toBe("fallback");
    expect(r.confidence).toBe("low");
    expect(r.etaMin).toBe(30);
  });

  it("3 samples → still fallback (sampleSize < 4)", () => {
    const r = predictETA({
      history: manySamples([20, 25, 30]),
      fallbackMin: 45,
    });
    expect(r.sampleSize).toBe(3);
    expect(r.source).toBe("fallback");
    expect(r.etaMin).toBe(45);
  });

  it("5 samples → blended (0.7*median + 0.3*fallback), med confidence", () => {
    // medians of [10,20,30,40,50] = 30; blend with fallback 50: 0.7*30 + 0.3*50 = 36 → rounds to 35
    const r = predictETA({
      history: manySamples([10, 20, 30, 40, 50]),
      fallbackMin: 50,
    });
    expect(r.sampleSize).toBe(5);
    expect(r.source).toBe("blended");
    expect(r.confidence).toBe("med");
    expect(r.etaMin).toBe(35);
  });

  it("10 samples → pure history, high confidence", () => {
    // All 30-minute durations → median 30
    const r = predictETA({
      history: manySamples([30, 30, 30, 30, 30, 30, 30, 30, 30, 30]),
      fallbackMin: 60,
    });
    expect(r.sampleSize).toBe(10);
    expect(r.source).toBe("history");
    expect(r.confidence).toBe("high");
    expect(r.etaMin).toBe(30);
  });

  it("rounds to nearest 5", () => {
    // single duration of 22 — but with only 1 sample we hit fallback,
    // so use a 10-sample uniform history at 22 → blend? No, 10 samples → history
    const r = predictETA({
      history: manySamples([22, 22, 22, 22, 22, 22, 22, 22, 22, 22]),
      fallbackMin: 30,
    });
    expect(r.etaMin).toBe(20); // 22 → 20
  });

  it("clamps to floor of 5 minutes", () => {
    const r = predictETA({ history: [], fallbackMin: 1 });
    expect(r.etaMin).toBe(5);
  });

  it("clamps to ceiling of 240 minutes", () => {
    const r = predictETA({ history: [], fallbackMin: 999 });
    expect(r.etaMin).toBe(240);
  });

  it("ignores zero-or-negative duration samples", () => {
    const base = 1_700_000_000_000;
    const broken: HistoricalSample[] = [
      // start === complete (0 duration) — dropped
      { startedAt: new Date(base), completedAt: new Date(base) },
      // negative — dropped
      { startedAt: new Date(base + 60_000), completedAt: new Date(base) },
    ];
    const r = predictETA({ history: broken, fallbackMin: 30 });
    expect(r.sampleSize).toBe(0);
    expect(r.source).toBe("fallback");
  });

  it("history of 4 samples uses blending (lower edge)", () => {
    // medians of [10, 20, 30, 40] = lower-mid index 1 = 20; blend with 30: 0.7*20 + 0.3*30 = 23 → 25
    const r = predictETA({
      history: manySamples([10, 20, 30, 40]),
      fallbackMin: 30,
    });
    expect(r.sampleSize).toBe(4);
    expect(r.source).toBe("blended");
    expect(r.etaMin).toBe(25);
  });
});
