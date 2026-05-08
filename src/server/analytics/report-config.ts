/**
 * Phase 18 Wave 3 — typed schema for `SavedReport.config`.
 *
 * `SavedReport.config` is `Json` in Prisma; the database accepts anything.
 * Every read AND write path validates through these zod schemas so a manual
 * DB poke or a bug in a future builder revision can't push garbage into
 * the runner. The version anchor pins the wire format — W4 may add a v2
 * shape (e.g. with embedded scheduling hints); v1 stays frozen.
 */
import { z } from "zod";

import { DIMENSION_KEYS, type DimensionKey } from "./dimensions";
import { MEASURE_KEYS, type MeasureKey } from "./measures";

/** AppointmentStatus enum values, mirrored from prisma/schema.prisma. */
export const APPOINTMENT_STATUS_VALUES = [
  "BOOKED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export type ReportAppointmentStatus = (typeof APPOINTMENT_STATUS_VALUES)[number];

/** Hard cap on row output — see runner statement_timeout + LIMIT. */
export const REPORT_LIMIT_DEFAULT = 500;
export const REPORT_LIMIT_MAX = 1000;

const DimensionKeyEnum = z.enum(DIMENSION_KEYS as [DimensionKey, ...DimensionKey[]]);
const MeasureKeyEnum = z.enum(MEASURE_KEYS as [MeasureKey, ...MeasureKey[]]);
const StatusEnum = z.enum(APPOINTMENT_STATUS_VALUES);

const IsoDate = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid_iso_date" });

const FiltersSchema = z
  .object({
    dateFrom: IsoDate.optional(),
    dateTo: IsoDate.optional(),
    branchIds: z.array(z.string().min(1)).max(50).optional(),
    doctorIds: z.array(z.string().min(1)).max(100).optional(),
    status: z.array(StatusEnum).max(APPOINTMENT_STATUS_VALUES.length).optional(),
  })
  .refine(
    (v) => {
      if (!v.dateFrom || !v.dateTo) return true;
      return Date.parse(v.dateFrom) <= Date.parse(v.dateTo);
    },
    { message: "date_range_inverted", path: ["dateTo"] },
  );

export const ReportConfigSchema = z
  .object({
    version: z.literal(1),
    dimensions: z
      .array(DimensionKeyEnum)
      .min(1, { message: "at_least_one_dimension" })
      .max(3, { message: "max_three_dimensions" })
      .refine((arr) => new Set(arr).size === arr.length, {
        message: "duplicate_dimensions",
      }),
    measures: z
      .array(MeasureKeyEnum)
      .min(1, { message: "at_least_one_measure" })
      .max(5, { message: "max_five_measures" })
      .refine((arr) => new Set(arr).size === arr.length, {
        message: "duplicate_measures",
      }),
    filters: FiltersSchema.default({}),
    ordering: z
      .object({
        by: z.string().min(1),
        direction: z.enum(["asc", "desc"]),
      })
      .optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(REPORT_LIMIT_MAX)
      .optional(),
  })
  .strict();

export type ReportConfig = z.infer<typeof ReportConfigSchema>;

export interface ReportConfigParseError {
  path: ReadonlyArray<string | number>;
  message: string;
}

/** Throws `Error` with a JSON-serialised issue list on failure. */
export function parseReportConfig(input: unknown): ReportConfig {
  const r = ReportConfigSchema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    }));
    throw Object.assign(new Error("InvalidReportConfig"), { issues });
  }
  return r.data;
}

export type SafeParseResult =
  | { ok: true; config: ReportConfig }
  | { ok: false; errors: ReportConfigParseError[] };

export function safeParseReportConfig(input: unknown): SafeParseResult {
  const r = ReportConfigSchema.safeParse(input);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.map((i) => ({
        path: i.path.filter(
          (p): p is string | number =>
            typeof p === "string" || typeof p === "number",
        ),
        message: i.message,
      })),
    };
  }
  return { ok: true, config: r.data };
}

/**
 * Resolve effective limit applied to a runner. Defensive — even if a
 * config slipped past validation with a bad value, this clamps it.
 */
export function resolveLimit(config: ReportConfig): number {
  const v = config.limit ?? REPORT_LIMIT_DEFAULT;
  if (!Number.isFinite(v)) return REPORT_LIMIT_DEFAULT;
  return Math.max(1, Math.min(REPORT_LIMIT_MAX, Math.trunc(v)));
}

/**
 * Default 30-day window when the saved config omits date bounds. Keeps
 * the runner total-time bounded even when an admin saves a "no-filter"
 * report. The runner always passes explicit dates to the query-builder.
 */
export function resolveDateRange(
  config: ReportConfig,
  now: Date = new Date(),
): { dateFrom: Date; dateTo: Date } {
  const f = config.filters ?? {};
  const to = f.dateTo
    ? new Date(f.dateTo)
    : new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      );
  const from = f.dateFrom
    ? new Date(f.dateFrom)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { dateFrom: from, dateTo: to };
}
