/**
 * Phase 10 — ETA predictor (pure, client-safe).
 *
 * Median-based duration predictor for the (doctor, service) pair. The resolver
 * supplies up to 30 historical samples with both `startedAt` and `completedAt`
 * timestamps. Bands:
 *
 *   sampleSize >= 10  → pure historical median, "high" confidence, "history"
 *   sampleSize 4..9   → 0.7 * median + 0.3 * fallback, "med", "blended"
 *   sampleSize  < 4   → fallback only, "low", "fallback"
 *
 * Output is clamped to [5, 240] minutes and rounded to the nearest 5 — matches
 * the resolution of the appointment grid.
 *
 * Pure module: zero imports. Inputs are plain `Date` objects; the caller
 * decides timezone. Median is the lower-mid for even-length arrays so behaviour
 * stays deterministic across runtimes.
 */

export interface HistoricalSample {
  startedAt: Date;
  completedAt: Date;
}

export interface EtaInput {
  history: HistoricalSample[];
  /** Default duration to fall back on (e.g. `service.durationMin`). */
  fallbackMin: number;
}

export interface EtaOutput {
  etaMin: number;
  sampleSize: number;
  confidence: "high" | "med" | "low";
  source: "history" | "blended" | "fallback";
}

function durationsMin(samples: HistoricalSample[]): number[] {
  const out: number[] = [];
  for (const s of samples) {
    const ms = s.completedAt.getTime() - s.startedAt.getTime();
    if (!Number.isFinite(ms) || ms <= 0) continue;
    out.push(ms / 60_000);
  }
  return out;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor((n - 1) / 2);
  return sorted[mid]!;
}

function clampRound(n: number): number {
  const clamped = Math.max(5, Math.min(240, n));
  return Math.round(clamped / 5) * 5;
}

export function predictETA(input: EtaInput): EtaOutput {
  const ds = durationsMin(input.history).sort((a, b) => a - b);
  const sampleSize = ds.length;
  const fallback = input.fallbackMin;

  if (sampleSize >= 10) {
    return {
      etaMin: clampRound(median(ds)),
      sampleSize,
      confidence: "high",
      source: "history",
    };
  }
  if (sampleSize >= 4) {
    const m = median(ds);
    const blended = 0.7 * m + 0.3 * fallback;
    return {
      etaMin: clampRound(blended),
      sampleSize,
      confidence: "med",
      source: "blended",
    };
  }
  return {
    etaMin: clampRound(fallback),
    sampleSize,
    confidence: "low",
    source: "fallback",
  };
}
