/**
 * Phase 18 Wave 1 — analytics dimension catalog.
 *
 * Pure declarations of the dimensions the W3 report-builder UI will surface.
 * Each dimension knows how to project itself into a SQL `SELECT … AS` slot
 * and how to label the resulting column in the response shape. No Prisma /
 * runtime dependencies — the query-builder composes these into raw SQL.
 *
 * Encrypted PII columns (Patient.notes/passport, MedicalCase.soapDraft,
 * Prescription.notes) are deliberately absent — they're AES-encrypted at
 * rest and not searchable / groupable. We aggregate over fullName,
 * phoneNormalized, birthDate, gender, clinicId, branchId, doctorId, etc.,
 * which are NOT encrypted (Phase 17 W4).
 *
 * Soft-deleted patients (Patient.deletedAt IS NOT NULL) are filtered out by
 * the query-builder's WHERE clause; dimensions don't have to repeat that
 * filter individually.
 *
 * Audit AN-09: a report «by doctor» used to print `cm3x9…` in the Doctor
 * column, and «by branch» the branch cuid, in the table, the CSV and the
 * PDF alike. A dimension now groups by its key (`sql`, the id) and shows a
 * name (`labelSql`, per interface language), so two doctors who share a
 * name still get a row each. Column headers come from i18n
 * (`analyticsReports.dimensions.*`, see report-runner.ts), not `label`.
 */

export type ReportLocale = "ru" | "uz";

export type DimensionKey =
  | "date"
  | "doctor"
  | "branch"
  | "specialty"
  | "patient_segment"
  | "source";

export interface DimensionDef {
  key: DimensionKey;
  /**
   * SQL expression evaluated in the context of an `Appointment a` row joined
   * to `Patient p` and `Doctor d`. The query-builder GROUPs BY this expression
   * verbatim, so it must be deterministic for a given row.
   */
  sql: string;
  /** Public column alias in the resulting JSON. */
  alias: string;
  /**
   * What the column shows instead of the grouping key, per interface
   * language (same FROM shape, `b` is the LEFT JOINed Branch). Grouped
   * together with `sql`. Absent: the key itself is shown.
   */
  labelSql?: Record<ReportLocale, string>;
  /** Cell rendering hint: `date` cells print as ДД.ММ.ГГГГ. */
  unit: "text" | "date";
  /** Developer-facing name; the UI header comes from i18n. */
  label: string;
}

/** patient_segment derived from existing aggregates (Patient.segment enum). */
const PATIENT_SEGMENT_SQL = `p."segment"::text`;

/**
 * `source` dimension prefers `Appointment.channel` (always set on every row)
 * and falls back to `Patient.source` (LeadSource? — may be null) when channel
 * doesn't carry useful info. `Appointment.channel` is enum `ChannelType`
 * (WALKIN/PHONE/TELEGRAM/WEBSITE/KIOSK), not `LeadSource` — but for the
 * acquisition lens both serve. The fallback string `'unknown'` keeps the
 * grouped output total-preserving.
 */
const SOURCE_SQL = `COALESCE(a."channel"::text, p."source"::text, 'unknown')`;

export const DIMENSIONS: Record<DimensionKey, DimensionDef> = {
  date: {
    key: "date",
    // Bucket by the clinic's civil day (Asia/Tashkent), not the Postgres
    // session zone. `a."date"` is TIMESTAMP(3) without time zone holding a UTC
    // instant, so we first label it UTC (`AT TIME ZONE 'UTC'` → timestamptz)
    // then convert that instant to Tashkent wall-clock (`AT TIME ZONE
    // 'Asia/Tashkent'` → timestamp) before truncating. Without this a 02:00
    // Tashkent appointment (21:00 UTC the day before) lands in the wrong day
    // whenever the DB session runs in UTC (the prod default).
    sql: `date_trunc('day', (a."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::date`,
    alias: "date",
    unit: "date",
    label: "Day",
  },
  doctor: {
    key: "doctor",
    sql: `a."doctorId"`,
    alias: "doctor",
    labelSql: {
      ru: `d."nameRu"`,
      uz: `COALESCE(NULLIF(d."nameUz", ''), d."nameRu")`,
    },
    unit: "text",
    label: "Doctor",
  },
  branch: {
    key: "branch",
    sql: `a."branchId"`,
    alias: "branch",
    // NULL (an appointment with no branch) renders as an empty cell.
    labelSql: {
      ru: `b."nameRu"`,
      uz: `COALESCE(NULLIF(b."nameUz", ''), b."nameRu")`,
    },
    unit: "text",
    label: "Branch",
  },
  specialty: {
    key: "specialty",
    // Grouped by the RU text as canonical, shown in the interface language.
    // Specialty field never holds PII so safe to project.
    sql: `d."specializationRu"`,
    alias: "specialty",
    labelSql: {
      ru: `d."specializationRu"`,
      uz: `COALESCE(NULLIF(d."specializationUz", ''), d."specializationRu")`,
    },
    unit: "text",
    label: "Specialty",
  },
  patient_segment: {
    key: "patient_segment",
    // Enum code; report-runner.ts swaps it for its i18n name.
    sql: PATIENT_SEGMENT_SQL,
    alias: "patientSegment",
    unit: "text",
    label: "Patient segment",
  },
  source: {
    key: "source",
    // Enum code; report-runner.ts swaps it for its i18n name.
    sql: SOURCE_SQL,
    alias: "source",
    unit: "text",
    label: "Source",
  },
};

/** All known dimension keys, in stable order for UI rendering. */
export const DIMENSION_KEYS: DimensionKey[] = [
  "date",
  "doctor",
  "branch",
  "specialty",
  "patient_segment",
  "source",
];

export function getDimension(key: string): DimensionDef | null {
  if (!(key in DIMENSIONS)) return null;
  return DIMENSIONS[key as DimensionKey];
}

export function isDimensionKey(key: string): key is DimensionKey {
  return key in DIMENSIONS;
}
