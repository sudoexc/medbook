/**
 * Phase 18 Wave 1 — doctor-performance resolver.
 *
 * Aggregates the clinic's resolved visits (COMPLETED, NO_SHOW) over an exact
 * [from, to) window and returns one ranked entry per doctor.
 *
 * It used to read `mv_doctor_performance`, whose grain is a calendar month,
 * and truncated both bounds to the month start (audit AN-03). «30 дней» on
 * 20.09 became [01.08, 01.09): August only, September invisible until the
 * last day of the month; «90 дней» and «С начала года» lost the current
 * month the same way. A month rollup cannot answer a window that starts and
 * ends mid-month, so the resolver now reads `Appointment` with the window's
 * own bounds (Tashkent days from `resolveDoctorPerfRange`). The rollup stays
 * for the per-month sparklines, which are monthly by nature.
 *
 * Definitions match the rollup:
 *   visitsCount       COMPLETED visits dated in the window;
 *   revenueTiins      their priceFinal, or priceService minus the discount
 *                     when no final price was written (`src/server/doctors/
 *                     stats.ts` uses the same formula);
 *   noShowCount       NO_SHOW visits dated in the window;
 *   newPatientCount   completed visits that are the patient's first
 *                     COMPLETED visit with this doctor; repeatVisitCount is
 *                     the rest. The ordinal is taken over the whole history,
 *                     not only the window, so a returning patient is never
 *                     «new» just because the window starts after her first
 *                     visit;
 *   npsAvg / npsCount PatientReview scores of the window's appointments.
 * Future-dated rows and soft-deleted patients are left out, as before.
 */

import type { RawQueryClient } from "./cohort-resolver";
import { resolveDoctorPerfRange } from "@/lib/analytics/dashboard-math";

interface RawDoctorRow {
  doctorId: string;
  visitsCount: bigint | number;
  revenueTiins: bigint | number;
  noShowCount: bigint | number;
  repeatVisitCount: bigint | number;
  newPatientCount: bigint | number;
  npsAvg: number | null;
  npsCount: bigint | number;
}

export interface DoctorPerformanceRow {
  doctorId: string;
  visitsCount: number;
  revenueTiins: number;
  noShowCount: number;
  repeatVisitCount: number;
  newPatientCount: number;
  npsAvg: number | null;
  npsCount: number;
}

export interface DoctorPerformanceOptions {
  /** Inclusive lower bound (an instant). Defaults to the «30 дней» window. */
  from?: Date;
  /** Exclusive upper bound (an instant). Defaults to the «30 дней» window. */
  to?: Date;
  /** Sort key (default `revenueTiins` desc). */
  sortBy?: "revenueTiins" | "visitsCount" | "noShowCount" | "npsAvg";
  /** Default 50, max 500. */
  limit?: number;
}

/**
 * $1 clinicId, $2 from (inclusive), $3 to (exclusive).
 *
 * `completedOrdinal` is the running count of COMPLETED visits per doctor and
 * patient up to and including the row, so a COMPLETED row with ordinal 1 is
 * the patient's first visit with that doctor. It is computed before the
 * window's lower bound is applied (the outer WHERE), over everything up to
 * `to`, so earlier history still counts.
 */
export const DOCTOR_PERFORMANCE_SQL = `
WITH visits AS (
  SELECT
    a."doctorId",
    a."status",
    a."date",
    COALESCE(
      a."priceFinal",
      COALESCE(a."priceService", 0) - COALESCE(a."discountAmount", 0)
    ) AS "revenueTiins",
    COUNT(*) FILTER (WHERE a."status" = 'COMPLETED') OVER (
      PARTITION BY a."doctorId", a."patientId"
      ORDER BY a."date", a."id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS "completedOrdinal"
  FROM "Appointment" a
  JOIN "Patient" p
    ON p."id" = a."patientId"
   AND p."deletedAt" IS NULL
  WHERE a."clinicId" = $1
    AND a."status" IN ('COMPLETED', 'NO_SHOW')
    AND a."date" <  $3
    AND a."date" <= NOW()
),
nps AS (
  SELECT
    r."doctorId",
    AVG(r."score")::float AS "npsAvg",
    COUNT(*)::bigint      AS "npsCount"
  FROM "PatientReview" r
  JOIN "Appointment" a
    ON a."id" = r."appointmentId"
  WHERE r."clinicId" = $1
    AND r."doctorId" IS NOT NULL
    AND a."date" >= $2
    AND a."date" <  $3
  GROUP BY r."doctorId"
)
SELECT
  v."doctorId",
  SUM(CASE WHEN v."status" = 'COMPLETED' THEN 1 ELSE 0 END)::bigint AS "visitsCount",
  SUM(CASE WHEN v."status" = 'COMPLETED' THEN v."revenueTiins" ELSE 0 END)::bigint AS "revenueTiins",
  SUM(CASE WHEN v."status" = 'NO_SHOW' THEN 1 ELSE 0 END)::bigint AS "noShowCount",
  SUM(CASE WHEN v."status" = 'COMPLETED' AND v."completedOrdinal" > 1 THEN 1 ELSE 0 END)::bigint AS "repeatVisitCount",
  SUM(CASE WHEN v."status" = 'COMPLETED' AND v."completedOrdinal" = 1 THEN 1 ELSE 0 END)::bigint AS "newPatientCount",
  MAX(n."npsAvg") AS "npsAvg",
  COALESCE(MAX(n."npsCount"), 0)::bigint AS "npsCount"
FROM visits v
LEFT JOIN nps n
  ON n."doctorId" = v."doctorId"
WHERE v."date" >= $2
GROUP BY v."doctorId"
`.trim();

export async function resolveDoctorPerformance(
  prisma: RawQueryClient,
  clinicId: string,
  opts: DoctorPerformanceOptions = {},
  now: Date = new Date(),
): Promise<{
  rows: DoctorPerformanceRow[];
  generatedAt: string;
  source: "live:appointments";
}> {
  const def = resolveDoctorPerfRange("30d", now);
  const from = opts.from ?? def.from;
  const to = opts.to ?? def.to;

  const sortBy = opts.sortBy ?? "revenueTiins";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);

  const raw = await prisma.$queryRawUnsafe<RawDoctorRow[]>(
    DOCTOR_PERFORMANCE_SQL,
    clinicId,
    from,
    to,
  );

  const rows = raw.map((r) => {
    const npsCount = Number(r.npsCount);
    return {
      doctorId: r.doctorId,
      visitsCount: Number(r.visitsCount),
      revenueTiins: Number(r.revenueTiins),
      noShowCount: Number(r.noShowCount),
      repeatVisitCount: Number(r.repeatVisitCount),
      newPatientCount: Number(r.newPatientCount),
      npsAvg: npsCount > 0 && r.npsAvg != null ? Number(r.npsAvg) : null,
      npsCount,
    } satisfies DoctorPerformanceRow;
  });

  rows.sort((a, b) => {
    const av = (a[sortBy] ?? -1) as number;
    const bv = (b[sortBy] ?? -1) as number;
    return bv - av;
  });

  return {
    rows: rows.slice(0, limit),
    generatedAt: now.toISOString(),
    source: "live:appointments",
  };
}
