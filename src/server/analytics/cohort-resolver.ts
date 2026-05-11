/**
 * Phase 18 Wave 1 — cohort retention resolver.
 *
 * Reads from `mv_cohort_retention` (24-month sliding window, see migration
 * SQL). Returns a matrix view ready for the W2 dashboard heatmap.
 *
 * Tenant-scoped: caller passes the clinicId (which the API layer extracts
 * from `runWithTenant`). The MV row always carries clinicId so the WHERE
 * clause is a single index hit.
 */

interface RawCohortRow {
  clinicId: string;
  cohortMonth: Date;
  monthOffset: number;
  activePatientCount: bigint | number;
}

export interface CohortCell {
  cohortMonth: string;
  monthOffset: number;
  activePatientCount: number;
}

export interface CohortMatrix {
  /** Row order: oldest cohort first. */
  cohorts: string[];
  cells: CohortCell[];
  generatedAt: string;
  source: "mv:mv_cohort_retention";
}

export interface RawQueryClient {
  $queryRawUnsafe: <T = unknown>(sql: string, ...values: unknown[]) => Promise<T>;
}

const SQL = `
SELECT
  "clinicId",
  "cohortMonth",
  "monthOffset",
  "activePatientCount"
FROM "mv_cohort_retention"
WHERE "clinicId" = $1
ORDER BY "cohortMonth" ASC, "monthOffset" ASC
`.trim();

function ymKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function resolveCohortRetention(
  prisma: RawQueryClient,
  clinicId: string,
): Promise<CohortMatrix> {
  let rows: RawCohortRow[];
  try {
    rows = await prisma.$queryRawUnsafe<RawCohortRow[]>(SQL, clinicId);
  } catch (e) {
    // MV exists but never refreshed yet (fresh install, or dev without the
    // analytics:refresh worker scheduled). Treat as "no cohort data yet"
    // rather than 500 — the dashboard heatmap renders an empty state.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("has not been populated")) {
      return {
        cohorts: [],
        cells: [],
        generatedAt: new Date().toISOString(),
        source: "mv:mv_cohort_retention",
      };
    }
    throw e;
  }
  const cohortSet = new Set<string>();
  const cells: CohortCell[] = [];
  for (const r of rows) {
    const cohort = ymKey(new Date(r.cohortMonth));
    cohortSet.add(cohort);
    cells.push({
      cohortMonth: cohort,
      monthOffset: Number(r.monthOffset),
      activePatientCount: Number(r.activePatientCount),
    });
  }
  return {
    cohorts: [...cohortSet].sort(),
    cells,
    generatedAt: new Date().toISOString(),
    source: "mv:mv_cohort_retention",
  };
}
