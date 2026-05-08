/**
 * Phase 18 Wave 3 — execute a `ReportConfig` against the analytics DB.
 *
 * Wraps W1's `buildAnalyticsQuery` with:
 *   - `statement_timeout` (30s) so a runaway aggregate can't pin a
 *     connection. We set/reset inside a transaction so a missed cleanup
 *     can't leak the override to the next tenant request.
 *   - row truncation flag — caller can show "showing first N rows" hint
 *     when the LIMIT is hit.
 *   - column descriptors keyed by the dimension/measure aliases, so the
 *     CSV layer doesn't have to re-derive labels.
 */
import {
  DIMENSIONS,
  type DimensionKey,
} from "./dimensions";
import {
  MEASURES,
  type MeasureKey,
  type MeasureDef,
} from "./measures";
import { buildAnalyticsQuery } from "./query-builder";
import {
  resolveDateRange,
  resolveLimit,
  type ReportConfig,
} from "./report-config";

export interface ReportColumn {
  key: string;
  label: string;
  /** "dimension" | "measure". Helps the UI render alignment / sort. */
  kind: "dimension" | "measure";
  unit?: MeasureDef["unit"] | "text";
}

export interface RunReportResult {
  rows: Array<Record<string, unknown>>;
  columns: ReportColumn[];
  rowCount: number;
  truncated: boolean;
  generatedAt: string;
  runMs: number;
}

export interface ReportRunnerClient {
  $queryRawUnsafe: <T = unknown>(
    sql: string,
    ...values: unknown[]
  ) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
  $transaction: <T>(
    fn: (tx: ReportRunnerClient) => Promise<T>,
  ) => Promise<T>;
}

const TIMEOUT_MS = 30_000;

export class ReportTimeoutError extends Error {
  constructor() {
    super("ReportTimeout");
    this.name = "ReportTimeoutError";
  }
}

/**
 * Build the column descriptor list in select order so the CSV / table
 * stay aligned with what the SQL projects.
 */
export function buildReportColumns(
  dims: ReadonlyArray<DimensionKey>,
  measures: ReadonlyArray<MeasureKey>,
): ReportColumn[] {
  const cols: ReportColumn[] = [];
  for (const k of dims) {
    const def = DIMENSIONS[k];
    cols.push({
      key: def.alias,
      label: def.label,
      kind: "dimension",
      unit: "text",
    });
  }
  for (const k of measures) {
    const def = MEASURES[k];
    cols.push({
      key: def.alias,
      label: def.label,
      kind: "measure",
      unit: def.unit,
    });
  }
  return cols;
}

function isStatementTimeout(err: unknown): boolean {
  const msg =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message ?? "")
      : "";
  return /statement timeout|canceling statement|57014/i.test(msg);
}

/**
 * Run the report against `client`. The caller has already validated the
 * config via zod and resolved the tenant via `runWithTenant`.
 */
export async function runReport(
  client: ReportRunnerClient,
  clinicId: string,
  config: ReportConfig,
  now: Date = new Date(),
): Promise<RunReportResult> {
  const { dateFrom, dateTo } = resolveDateRange(config, now);
  const limit = resolveLimit(config);
  const built = buildAnalyticsQuery({
    clinicId,
    dimensions: [...config.dimensions],
    measures: [...config.measures],
    filters: {
      dateFrom,
      dateTo,
      branchIds: config.filters?.branchIds
        ? [...config.filters.branchIds]
        : undefined,
      doctorIds: config.filters?.doctorIds
        ? [...config.filters.doctorIds]
        : undefined,
      status: config.filters?.status ? [...config.filters.status] : undefined,
    },
    limit,
  });

  const startedAt = Date.now();
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await client.$transaction(async (tx) => {
      // statement_timeout is per-connection in PG; we set it inside the
      // tx so the override is scoped and rolled back.
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
      return tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        built.sql,
        ...built.values,
      );
    });
  } catch (err) {
    if (isStatementTimeout(err)) throw new ReportTimeoutError();
    throw err;
  }

  const runMs = Date.now() - startedAt;
  const columns = buildReportColumns(config.dimensions, config.measures);
  return {
    rows,
    columns,
    rowCount: rows.length,
    truncated: rows.length === limit,
    generatedAt: new Date().toISOString(),
    runMs,
  };
}
