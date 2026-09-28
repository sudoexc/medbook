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
 * The identity columns an anonymization or hard delete removed, by NAME,
 * for the `meta` of the PATIENT_ANONYMIZED / PATIENT_HARD_DELETED audit row
 * (audit SEC-09).
 *
 * It used to be a «forensic» copy of the values (full name, phone, Telegram
 * id, decrypted passport), so the person a DSAR request erased stayed fully
 * identifiable in «Настройки → Аудит» and in any database dump. The row id
 * (the audit row's entityId) and the job id are what tie the event to the
 * request; the identity itself is not kept anywhere.
 */
export function erasedIdentityFields(patient: {
  fullName: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  passport: string | null;
}): string[] {
  return (
    [
      "fullName",
      "phone",
      "phoneNormalized",
      "telegramId",
      "telegramUsername",
      "passport",
    ] as const
  ).filter((k) => {
    const v = patient[k];
    return v !== null && v !== undefined && v !== "";
  });
}
