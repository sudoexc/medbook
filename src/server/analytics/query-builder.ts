/**
 * Phase 18 Wave 1 — Pure SQL builder for the W3 report builder.
 *
 * Given { dimensions, measures, filters } returns a parameterized SQL string
 * plus a values[] array suitable for `prisma.$queryRawUnsafe(sql, ...values)`.
 *
 * Tenant isolation
 * ----------------
 * `clinicId` is ALWAYS injected as the first positional parameter ($1).
 * The caller MUST pass it explicitly (the Prisma extension only auto-scopes
 * model methods, not raw SQL). Passing it via `values[0]` keeps the SQL free
 * of identifier interpolation — the only thing we string-interpolate is
 * dimension/measure SQL, which is sourced from a hard-coded catalog (see
 * `dimensions.ts` / `measures.ts`) and never from user input.
 *
 * Filter inputs are likewise parameterized — branchIds / doctorIds become
 * `ANY($n::text[])` placeholders, dateFrom/dateTo are positional timestamps.
 *
 * Soft-deleted patients (Patient.deletedAt IS NOT NULL) are filtered out via
 * an INNER JOIN with `p."deletedAt" IS NULL` so anonymized rows never appear
 * as identifiable entries. The query-builder owns this filter so callers
 * don't have to repeat it.
 *
 * Names, not ids (audit AN-09): a dimension with a `labelSql` projects the
 * name in the interface language and groups by id AND name. Ordering: the
 * saved `ordering` used to be accepted and ignored; it is applied now, but
 * only to a column the report selects (resolved against the catalog keys
 * and aliases, never interpolated from input), with the dimensions as tie
 * breakers so the order is stable.
 */

import type { DimensionKey, ReportLocale } from "./dimensions";
import { DIMENSIONS, isDimensionKey } from "./dimensions";
import type { MeasureKey } from "./measures";
import { MEASURES, isMeasureKey } from "./measures";

export interface QueryBuilderFilters {
  /** Inclusive lower bound for `Appointment.date`. */
  dateFrom: Date;
  /** Exclusive upper bound for `Appointment.date`. */
  dateTo: Date;
  branchIds?: string[];
  doctorIds?: string[];
  /** Optional appointment-status whitelist (defaults to all). */
  status?: string[];
}

export interface QueryBuilderOrdering {
  /** A selected dimension/measure, by catalog key or by column alias. */
  by: string;
  direction: "asc" | "desc";
}

export interface QueryBuilderInput {
  /** clinicId from the AsyncLocalStorage tenant context. */
  clinicId: string;
  dimensions: DimensionKey[];
  measures: MeasureKey[];
  filters: QueryBuilderFilters;
  /** Optional row cap. Defaults to 10_000 — generous but bounded. */
  limit?: number;
  /** Language of the names shown for doctors, branches, specialties. */
  locale?: ReportLocale;
  /** Sort column; ignored unless it is one of the selected columns. */
  ordering?: QueryBuilderOrdering;
}

export interface QueryBuilderResult {
  sql: string;
  values: unknown[];
  /** Output column order (selectColumns + measureColumns). */
  columns: string[];
}

const DEFAULT_LIMIT = 10_000;

/**
 * Build the parameterized SQL for the report-builder run.
 *
 * Throws if any dimension or measure key is unknown — defensive against
 * a bad config arriving from the W3 builder JSON.
 */
export function buildAnalyticsQuery(
  input: QueryBuilderInput,
): QueryBuilderResult {
  const { clinicId, dimensions, measures, filters } = input;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const locale: ReportLocale = input.locale === "uz" ? "uz" : "ru";

  if (dimensions.length === 0 && measures.length === 0) {
    throw new Error("Query must request at least one dimension or measure");
  }
  for (const d of dimensions) {
    if (!isDimensionKey(d)) throw new Error(`Unknown dimension: ${d}`);
  }
  for (const m of measures) {
    if (!isMeasureKey(m)) throw new Error(`Unknown measure: ${m}`);
  }

  const values: unknown[] = [clinicId];
  const placeholders: { clinicId: string } = { clinicId: "$1" };

  // dateFrom / dateTo land at positional indexes 2/3.
  values.push(filters.dateFrom);
  const fromIdx = `$${values.length}`;
  values.push(filters.dateTo);
  const toIdx = `$${values.length}`;

  const where: string[] = [
    `a."clinicId" = ${placeholders.clinicId}`,
    `a."date" >= ${fromIdx}`,
    `a."date" <  ${toIdx}`,
    `p."deletedAt" IS NULL`,
  ];

  if (filters.branchIds && filters.branchIds.length > 0) {
    values.push(filters.branchIds);
    where.push(`a."branchId" = ANY($${values.length}::text[])`);
  }
  if (filters.doctorIds && filters.doctorIds.length > 0) {
    values.push(filters.doctorIds);
    where.push(`a."doctorId" = ANY($${values.length}::text[])`);
  }
  if (filters.status && filters.status.length > 0) {
    values.push(filters.status);
    // Cast through `text[]` so the enum compares as a string list.
    where.push(`a."status"::text = ANY($${values.length}::text[])`);
  }

  const selectParts: string[] = [];
  const groupBys: string[] = [];
  const columns: string[] = [];

  // Default order: by what each dimension shows (the name, the day).
  const dimensionOrder: string[] = [];

  for (const dKey of dimensions) {
    const def = DIMENSIONS[dKey];
    const shown = def.labelSql ? def.labelSql[locale] : def.sql;
    selectParts.push(`${shown} AS "${def.alias}"`);
    // GROUP BY by the SQL expression rather than the alias to dodge
    // dialect quirks around aliased ordinals. The id stays in the group so
    // two doctors with the same name are two rows.
    groupBys.push(def.sql);
    if (shown !== def.sql) groupBys.push(shown);
    dimensionOrder.push(shown);
    columns.push(def.alias);
  }
  for (const mKey of measures) {
    const def = MEASURES[mKey];
    selectParts.push(`${def.sql} AS "${def.alias}"`);
    columns.push(def.alias);
  }

  const orderBy = buildOrderBy(input.ordering, dimensions, measures, dimensionOrder);

  const sql = `
SELECT
  ${selectParts.join(",\n  ")}
FROM "Appointment" a
JOIN "Patient" p ON p."id" = a."patientId"
JOIN "Doctor"  d ON d."id" = a."doctorId"
LEFT JOIN "Branch" b ON b."id" = a."branchId"
WHERE ${where.join("\n  AND ")}
${groupBys.length > 0 ? `GROUP BY ${groupBys.join(", ")}` : ""}
${orderBy.length > 0 ? `ORDER BY ${orderBy.join(", ")}` : ""}
LIMIT ${Math.max(1, Math.min(limit, 100_000))}
`.trim();

  return { sql, values, columns };
}

/**
 * The ORDER BY list: the requested column first (by its output alias, which
 * Postgres resolves to the projected column), then the dimensions. A request
 * for a column the report does not select is ignored, never interpolated.
 */
function buildOrderBy(
  ordering: QueryBuilderOrdering | undefined,
  dimensions: ReadonlyArray<DimensionKey>,
  measures: ReadonlyArray<MeasureKey>,
  dimensionOrder: ReadonlyArray<string>,
): string[] {
  const out: string[] = [];
  if (ordering) {
    const dir = ordering.direction === "asc" ? "ASC" : "DESC";
    const dim = dimensions.find(
      (k) => k === ordering.by || DIMENSIONS[k].alias === ordering.by,
    );
    const measure = measures.find(
      (k) => k === ordering.by || MEASURES[k].alias === ordering.by,
    );
    const alias = dim
      ? DIMENSIONS[dim].alias
      : measure
        ? MEASURES[measure].alias
        : null;
    if (alias) out.push(`"${alias}" ${dir} NULLS LAST`);
  }
  return [...out, ...dimensionOrder];
}
