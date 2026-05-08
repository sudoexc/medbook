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
 */

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
  /** Human-readable label (used by W3 UI; W1 only declares it). */
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
    sql: `date_trunc('day', a."date")::date`,
    alias: "date",
    label: "Day",
  },
  doctor: {
    key: "doctor",
    sql: `a."doctorId"`,
    alias: "doctorId",
    label: "Doctor",
  },
  branch: {
    key: "branch",
    sql: `a."branchId"`,
    alias: "branchId",
    label: "Branch",
  },
  specialty: {
    key: "specialty",
    // Stored RU/UZ-localized; analytics groups by RU as canonical (UI can map
    // when rendering). Specialty field never holds PII so safe to project.
    sql: `d."specializationRu"`,
    alias: "specialty",
    label: "Specialty",
  },
  patient_segment: {
    key: "patient_segment",
    sql: PATIENT_SEGMENT_SQL,
    alias: "patientSegment",
    label: "Patient segment",
  },
  source: {
    key: "source",
    sql: SOURCE_SQL,
    alias: "source",
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
