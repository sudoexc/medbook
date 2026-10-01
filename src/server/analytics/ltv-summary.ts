/**
 * The «Средний LTV» figure of the analytics dashboard (audit AN-05).
 *
 * It used to be invented in the browser: bucket midpoints keyed "0-300k",
 * "300k-600k"… against buckets the API names "0", "<500k"…, so every lookup
 * fell back to 1 500 000 сум and the tile read the same number for any
 * clinic and any period. Now it is `SUM(ltv) / COUNT(*)` over the clinic's
 * patients (soft-deleted ones left out), i.e. what
 * `SELECT AVG(ltv) FROM "Patient" WHERE "clinicId" = …` returns, and it
 * moves as payments are recorded.
 */
export interface LtvSummary {
  /** Average Patient.ltv in tiins; null when nobody has paid anything. */
  averageTiins: number | null;
  patients: number;
}

export function averageLtv(
  agg: { patients: number; ltvSum: number } | null,
): LtvSummary {
  if (!agg || agg.patients <= 0) return { averageTiins: null, patients: 0 };
  // No payment anywhere: an average of nothing is not «0 сум».
  if (!(agg.ltvSum > 0)) return { averageTiins: null, patients: agg.patients };
  return {
    averageTiins: Math.round(agg.ltvSum / agg.patients),
    patients: agg.patients,
  };
}
