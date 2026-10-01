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
 * summaryCache, birthDate (with the name it pinned the person down),
 * the phone / Telegram verification stamps, all PII free-text fields.
 *
 * What else a DSAR erasure covers (audit PT-07, carried out by
 * `src/server/workers/data-deletion.ts`):
 *   - erased: site requests and leads (`Lead`, `OnlineRequest`, by card,
 *     and by the card's own number when no card owns the row: a family
 *     shares one number), sent notification texts and recipients
 *     (`NotificationSend`), communication log bodies, call summaries,
 *     recordings and the patient's number on calls, chat messages and the
 *     inbox preview, review comments, the clinical note, the doctors'
 *     reminders about the patient, appointment notes, SOAP drafts, and
 *     every stored FILE of the patient: documents (uploads, scans and
 *     rendered PDFs, rows and objects), chat attachments (objects and
 *     links) and the issued conclusion PDFs of visit-note revisions. A
 *     file carries the name on its pages, so no file survives.
 *   - kept, by policy: the structured medical record (visit notes and
 *     their revisions' content, diagnoses, prescriptions, allergies, lab
 *     orders and results, sick leaves, referrals, appointments, payments).
 *     Medical documentation has a legal retention duty that outlives a
 *     personal-data request; it stays on the anonymised card, which has no
 *     name, phone, passport, birth date or Telegram any more, and is hidden
 *     from every list and search. A PDF needed later is rendered again,
 *     under the anonymised name.
 *   - never: a hard delete of the card. HARD_DELETE requests are carried
 *     out as this anonymization: deleting the card would cascade the
 *     medical records away or fail on their foreign keys.
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
  phoneVerifiedAt: null;
  birthDate: null;
  telegramLinkedAt: null;
  tgBlockedAt: null;
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
    phoneVerifiedAt: null,
    birthDate: null,
    telegramLinkedAt: null,
    tgBlockedAt: null,
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
