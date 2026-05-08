/**
 * Phase 17 Wave 3 — Patient anonymization helper.
 *
 * Pure function: takes a Patient row and a job id, returns the partial
 * Prisma update payload that scrubs PII while preserving aggregate
 * analytics.
 *
 * The anonymized row keeps: id, clinicId, segment, ltv, visitsCount,
 * balance, lastVisitAt, nextVisitAt, createdAt, updatedAt — anything
 * the receptionist's revenue dashboards or the doctor's schedule
 * forecasts depend on.
 *
 * The anonymized row scrubs: fullName, phone, phoneNormalized,
 * passport, address, telegramId, telegramUsername, photoUrl, notes,
 * summaryCache, marketingOptOutSource, all PII free-text fields.
 *
 * `phoneNormalized` is special: the schema has `@@unique([clinicId,
 * phoneNormalized])`. We can't set everyone's normalized phone to the
 * same sentinel — we'd violate uniqueness. Instead we use
 * `deleted:<jobId>` as a per-row sentinel. The job id is a cuid,
 * already unique.
 *
 * `deletedAt` is stamped to the supplied execution time so the
 * consent-gate helper continues to suppress all sends for the row.
 *
 * The function returns a plain object the caller passes to
 * `prisma.patient.update({ where: { id }, data: <returned> })`. Pure
 * by design — it does not touch Prisma so it is trivially testable.
 */

export type AnonymizationResult = {
  fullName: string;
  phone: string;
  phoneNormalized: string;
  passport: null;
  address: null;
  telegramId: null;
  telegramUsername: null;
  photoUrl: null;
  notes: null;
  summaryCache: null;
  summaryCacheUpdatedAt: null;
  marketingOptOut: true;
  marketingOptOutAt: Date;
  marketingOptOutSource: "data-deletion";
  deletedAt: Date;
  deletionRequestedAt: Date;
  deletionReason: string;
  consentMarketing: false;
  tags: string[];
};

export const ANONYMIZED_FULL_NAME = "Удалённый пациент";

/**
 * Build the Prisma update payload that scrubs the patient row.
 *
 * @param jobId   DataDeletionJob id — used in the phone sentinel and the
 *                deletionReason for traceability.
 * @param now     Execution timestamp. Stamped into deletedAt /
 *                deletionRequestedAt / marketingOptOutAt so the row
 *                consistently shows when the scrub ran.
 */
export function buildAnonymizationPayload(
  jobId: string,
  now: Date,
): AnonymizationResult {
  return {
    fullName: ANONYMIZED_FULL_NAME,
    phone: "",
    phoneNormalized: `deleted:${jobId}`,
    passport: null,
    address: null,
    telegramId: null,
    telegramUsername: null,
    photoUrl: null,
    notes: null,
    summaryCache: null,
    summaryCacheUpdatedAt: null,
    marketingOptOut: true,
    marketingOptOutAt: now,
    marketingOptOutSource: "data-deletion",
    deletedAt: now,
    deletionRequestedAt: now,
    deletionReason: `dsar:${jobId}`,
    consentMarketing: false,
    tags: [],
  };
}

/**
 * Snapshot the pre-scrub identifiers so the audit log can later recover
 * "who was patient X" without exposing it to the live UI. Goes into the
 * `meta.before` of the PATIENT_ANONYMIZED audit row.
 */
export function snapshotForensicFields(patient: {
  fullName: string;
  phone: string;
  phoneNormalized: string;
  telegramId: string | null;
  telegramUsername: string | null;
  passport: string | null;
}): {
  fullName: string;
  phone: string;
  phoneNormalized: string;
  telegramId: string | null;
  telegramUsername: string | null;
  passport: string | null;
} {
  return {
    fullName: patient.fullName,
    phone: patient.phone,
    phoneNormalized: patient.phoneNormalized,
    telegramId: patient.telegramId,
    telegramUsername: patient.telegramUsername,
    passport: patient.passport,
  };
}
