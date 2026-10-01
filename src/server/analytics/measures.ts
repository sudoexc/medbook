/**
 * Phase 18 Wave 1 — analytics measure catalog.
 *
 * Pure declarations of the measures the W3 report-builder will expose. Each
 * measure is an aggregate SQL expression evaluated against the same FROM
 * shape as `dimensions.ts`: an Appointment row `a` joined to Patient `p`
 * and Doctor `d`.
 *
 * Money is in tiins (×100 of soum). Sum in tiins; the API layer or the UI
 * divides by 100 only when rendering — matching the rest of the codebase
 * (`Payment.amount`, `Appointment.priceFinal`, etc.). Every renderer shows
 * сум, so no header may say «tiins» (audit AN-09): headers come from i18n
 * (`analyticsReports.measures.*` plus the «, сум» suffix, report-runner.ts).
 */

export type MeasureKey =
  | "count_visits"
  | "revenue_tiins"
  | "no_show_rate"
  | "avg_ticket_tiins"
  | "ltv_tiins";

export interface MeasureDef {
  key: MeasureKey;
  /** Aggregate SQL expression. Should always cast to `numeric` or `bigint`. */
  sql: string;
  alias: string;
  /** Developer-facing name; the UI header comes from i18n. */
  label: string;
  /** Output unit hint for the W3 UI. */
  unit: "count" | "tiins" | "ratio";
}

/**
 * Revenue per appointment row — `priceFinal` if set (post-discount /
 * post-commission), else `priceService - discountAmount`. Matches what the
 * MV uses so resolver outputs and ad-hoc reports agree.
 */
const REVENUE_PER_APPT_SQL = `
  COALESCE(
    a."priceFinal",
    COALESCE(a."priceService", 0) - COALESCE(a."discountAmount", 0)
  )
`;

export const MEASURES: Record<MeasureKey, MeasureDef> = {
  count_visits: {
    key: "count_visits",
    sql: `SUM(CASE WHEN a."status" = 'COMPLETED' THEN 1 ELSE 0 END)::bigint`,
    alias: "countVisits",
    label: "Visits",
    unit: "count",
  },
  revenue_tiins: {
    key: "revenue_tiins",
    sql: `SUM(CASE WHEN a."status" = 'COMPLETED' THEN ${REVENUE_PER_APPT_SQL} ELSE 0 END)::bigint`,
    alias: "revenueTiins",
    label: "Revenue",
    unit: "tiins",
  },
  no_show_rate: {
    key: "no_show_rate",
    sql: `
      CASE
        WHEN SUM(CASE WHEN a."status" IN ('COMPLETED', 'NO_SHOW') THEN 1 ELSE 0 END) = 0
        THEN 0
        ELSE SUM(CASE WHEN a."status" = 'NO_SHOW' THEN 1 ELSE 0 END)::float
             / SUM(CASE WHEN a."status" IN ('COMPLETED', 'NO_SHOW') THEN 1 ELSE 0 END)::float
      END
    `,
    alias: "noShowRate",
    label: "No-show rate",
    unit: "ratio",
  },
  avg_ticket_tiins: {
    key: "avg_ticket_tiins",
    sql: `
      CASE
        WHEN SUM(CASE WHEN a."status" = 'COMPLETED' THEN 1 ELSE 0 END) = 0
        THEN 0
        ELSE (
          SUM(CASE WHEN a."status" = 'COMPLETED' THEN ${REVENUE_PER_APPT_SQL} ELSE 0 END)::bigint
          / SUM(CASE WHEN a."status" = 'COMPLETED' THEN 1 ELSE 0 END)::bigint
        )
      END
    `,
    alias: "avgTicketTiins",
    label: "Avg. ticket",
    unit: "tiins",
  },
  ltv_tiins: {
    key: "ltv_tiins",
    // LTV = the patient's PAID payments (`Patient.ltv`, kept by the payment
    // pipeline, `recalcLtv`). Re-computing it from Appointment would scan
    // the whole history per group. We sum it across the group's distinct
    // patients.
    //
    // It used to be `SUM(DISTINCT p."ltv")` (audit AN-10): DISTINCT applies
    // to the value, not the patient, so twenty patients who each paid one
    // 150 000 сум consultation summed to 150 000. The group's patient ids
    // are collected with ARRAY_AGG(DISTINCT …) (an aggregate of the outer,
    // grouped query, so it is evaluated per group) and their LTVs summed
    // once each.
    sql: `(
      SELECT COALESCE(SUM(lp."ltv"), 0)
      FROM "Patient" lp
      WHERE lp."id" = ANY(ARRAY_AGG(DISTINCT a."patientId"))
    )::bigint`,
    alias: "ltvTiins",
    label: "Patients' LTV",
    unit: "tiins",
  },
};

export const MEASURE_KEYS: MeasureKey[] = [
  "count_visits",
  "revenue_tiins",
  "no_show_rate",
  "avg_ticket_tiins",
  "ltv_tiins",
];

export function getMeasure(key: string): MeasureDef | null {
  if (!(key in MEASURES)) return null;
  return MEASURES[key as MeasureKey];
}

export function isMeasureKey(key: string): key is MeasureKey {
  return key in MEASURES;
}
