/**
 * Who a document came from (audit CD-06) and which documents are legal
 * records nobody may delete or swap the file of (audit CD-09).
 *
 * Pure, so the API routes enforce exactly what the lists use to hide the
 * buttons the API would refuse.
 *
 *   - A rendered document (conclusion, referral PDF) is the image of its
 *     source record. Deleting it took the conclusion out of the patient's
 *     Telegram, and the worker then minted a new one with a NEW QR token, so
 *     the paper already handed out stopped verifying.
 *   - A signed consent or contract is the clinic's proof. «Заменить файл»
 *     used to keep «Подписано» on whatever was uploaded instead and delete
 *     the original scan.
 *   - Since nobody may delete a signed record, one filed by mistake is
 *     voided instead (ADMIN, with a reason): it stays, file and all, but
 *     no longer counts as signed and leaves the patient's Mini App.
 */

export type DocumentSourceValue = "STAFF" | "PATIENT" | "SYSTEM";

export type DocumentGuardInput = {
  type: string;
  visitNoteId?: string | null;
  referralId?: string | null;
  signedAt?: Date | string | null;
  source?: string | null;
  voidedAt?: Date | string | null;
};

export type DocumentLock = "rendered_document" | "signed_document";

/** Types the clinic has a patient sign. */
export const SIGNABLE_DOCUMENT_TYPES = ["CONSENT", "CONTRACT"] as const;

/**
 * Rendered by a worker from its source record. The links are checked as
 * well as the source and type, so a legacy row (a conclusion whose note was
 * deleted, a row from before the source column) cannot slip through.
 */
export function isRenderedDocument(doc: DocumentGuardInput): boolean {
  return (
    doc.type === "CONCLUSION" ||
    Boolean(doc.visitNoteId) ||
    Boolean(doc.referralId) ||
    doc.source === "SYSTEM"
  );
}

/** Sent by the patient from the Mini App, never checked by the clinic. */
export function isPatientDocument(doc: Pick<DocumentGuardInput, "source">): boolean {
  return doc.source === "PATIENT";
}

/** Voided by ADMIN: kept as a record, never shown as valid. */
export function isVoidedDocument(doc: Pick<DocumentGuardInput, "voidedAt">): boolean {
  return doc.voidedAt != null;
}

/** Why this document may not be deleted, or null when it may. */
export function documentDeleteLock(doc: DocumentGuardInput): DocumentLock | null {
  if (isRenderedDocument(doc)) return "rendered_document";
  if (doc.signedAt != null) return "signed_document";
  return null;
}

/**
 * Why the file or the type of this document may not be changed, or null.
 * Same rule as delete: retyping a signed consent to «Другое» would make it
 * deletable, and a new file under «Подписано» is a forged signature.
 */
export function documentReplaceLock(doc: DocumentGuardInput): DocumentLock | null {
  return documentDeleteLock(doc);
}

/**
 * May staff press «Отметить подписанным»? Only on the clinic's own consent
 * or contract that is not signed yet: a patient's photo filed as «Согласие»
 * is not the clinic's consent, whatever it is called.
 */
export function canMarkSigned(doc: DocumentGuardInput): boolean {
  return (
    (SIGNABLE_DOCUMENT_TYPES as readonly string[]).includes(doc.type) &&
    doc.signedAt == null &&
    !isVoidedDocument(doc) &&
    !isPatientDocument(doc) &&
    !isRenderedDocument(doc)
  );
}

/**
 * May ADMIN void this document? Only a signed record that is not voided
 * yet. An unsigned upload is simply deleted; a conclusion or a referral PDF
 * is corrected through its source record, which re-renders it.
 */
export function canVoidDocument(doc: DocumentGuardInput): boolean {
  return documentDeleteLock(doc) === "signed_document" && !isVoidedDocument(doc);
}
