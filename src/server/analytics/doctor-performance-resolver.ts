/**
 * Phase 18 Wave 1 — doctor-performance resolver.
 *
 * Reads from `mv_doctor_performance`. Aggregates rows across the requested
 * month range and returns one ranked entry per doctor.
 *
 * Date filtering uses inclusive `monthFrom` (truncated to month) and
 * exclusive `monthTo`. When omitted, we default to the trailing 12 months
 * so first-page payloads stay small.
 */

import type { RawQueryClient } from "./cohort-resolver";

interface RawDoctorRow {
  clinicId: string;
  doctorId: string;
  month: Date;
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
  /** Inclusive — defaults to start of month, 12 months ago. */
  monthFrom?: Date;
  /** Exclusive — defaults to start of next month. */
  monthTo?: Date;
  /** Sort key (default `revenueTiins` desc). */
  sortBy?: "revenueTiins" | "visitsCount" | "noShowCount" | "npsAvg";
  /** Default 50, max 500. */
  limit?: number;
}

const SQL = `
SELECT
  "clinicId",
  "doctorId",
  "month",
  "visitsCount",
  "revenueTiins",
  "noShowCount",
  "repeatVisitCount",
  "newPatientCount",
  "npsAvg",
  "npsCount"
FROM "mv_doctor_performance"
WHERE "clinicId" = $1
  AND "month" >= $2
  AND "month" <  $3
`.trim();

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function defaultRange(now: Date): { monthFrom: Date; monthTo: Date } {
  const thisMonthStart = startOfMonthUtc(now);
  const monthFrom = new Date(
    Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() - 12, 1),
  );
  const monthTo = new Date(
    Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() + 1, 1),
  );
  return { monthFrom, monthTo };
}

export async function resolveDoctorPerformance(
  prisma: RawQueryClient,
  clinicId: string,
  opts: DoctorPerformanceOptions = {},
  now: Date = new Date(),
): Promise<{
  rows: DoctorPerformanceRow[];
  generatedAt: string;
  source: "mv:mv_doctor_performance";
}> {
  const { monthFrom, monthTo } = (() => {
    const def = defaultRange(now);
    return {
      monthFrom: opts.monthFrom ? startOfMonthUtc(opts.monthFrom) : def.monthFrom,
      monthTo: opts.monthTo ? startOfMonthUtc(opts.monthTo) : def.monthTo,
    };
  })();

  const sortBy = opts.sortBy ?? "revenueTiins";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);

  const raw = await prisma.$queryRawUnsafe<RawDoctorRow[]>(
    SQL,
    clinicId,
    monthFrom,
    monthTo,
  );

  // Aggregate across the requested month range.
  const agg = new Map<
    string,
    DoctorPerformanceRow & { npsScoreSum: number }
  >();
  for (const r of raw) {
    const did = r.doctorId;
    const cur =
      agg.get(did) ??
      ({
        doctorId: did,
        visitsCount: 0,
        revenueTiins: 0,
        noShowCount: 0,
        repeatVisitCount: 0,
        newPatientCount: 0,
        npsAvg: null,
        npsCount: 0,
        npsScoreSum: 0,
      } as DoctorPerformanceRow & { npsScoreSum: number });

    cur.visitsCount += Number(r.visitsCount);
    cur.revenueTiins += Number(r.revenueTiins);
    cur.noShowCount += Number(r.noShowCount);
    cur.repeatVisitCount += Number(r.repeatVisitCount);
    cur.newPatientCount += Number(r.newPatientCount);
    const npsCount = Number(r.npsCount);
    if (npsCount > 0 && r.npsAvg != null) {
      cur.npsCount += npsCount;
      cur.npsScoreSum += r.npsAvg * npsCount;
    }
    agg.set(did, cur);
  }
  // Finalize npsAvg per doctor.
  const rows = [...agg.values()].map((r) => {
    const finalNps = r.npsCount > 0 ? r.npsScoreSum / r.npsCount : null;
    return {
      doctorId: r.doctorId,
      visitsCount: r.visitsCount,
      revenueTiins: r.revenueTiins,
      noShowCount: r.noShowCount,
      repeatVisitCount: r.repeatVisitCount,
      newPatientCount: r.newPatientCount,
      npsAvg: finalNps,
      npsCount: r.npsCount,
    } satisfies DoctorPerformanceRow;
  });

  rows.sort((a, b) => {
    const av = (a[sortBy] ?? -1) as number;
    const bv = (b[sortBy] ?? -1) as number;
    return bv - av;
  });

  return {
    rows: rows.slice(0, limit),
    generatedAt: new Date().toISOString(),
    source: "mv:mv_doctor_performance",
  };
}
