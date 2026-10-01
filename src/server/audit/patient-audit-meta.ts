/**
 * What a patient audit row may say about the patient (audit SEC-09).
 *
 * `patient.update` used to diff the decrypted rows, so every card edit at
 * the desk wrote the passport and the notes into AuditLog.meta in plain
 * text, next to the full name and phone; `patient.create` and
 * `patient.delete` stored the whole decrypted card. The column encryption
 * of `passport` / `notes` was then moot for anyone who can read the audit
 * log or a database dump, and a DSAR anonymization left the person fully
 * identifiable in «Настройки → Аудит».
 *
 * Now the identity and free-text columns are recorded by NAME only («which
 * fields changed»); ordinary card settings (segment, tags, language,
 * consent, discount) keep their before/after values, which is what an
 * audit trail of the card is read for. The case audit rows follow the same
 * rule for the encrypted SOAP draft, and no longer copy the patient's name
 * and phone from the case's `patient` include.
 */

/**
 * Columns that identify the person or carry free text about them. Their
 * values never go into AuditLog.meta.
 */
export const PATIENT_PII_FIELDS: ReadonlySet<string> = new Set([
  "fullName",
  "phone",
  "phoneNormalized",
  "passport",
  "address",
  "notes",
  "birthDate",
  "telegramId",
  "telegramUsername",
  "photoUrl",
  "summaryCache",
]);

/**
 * Encrypted case columns (`serializeMedicalCaseForWrite`): recorded by name
 * only, like the patient's identity.
 */
export const CASE_NAME_ONLY_FIELDS: ReadonlySet<string> = new Set(["soapDraft"]);

/** Bookkeeping columns that change on every write and say nothing. */
const NOISE_FIELDS: ReadonlySet<string> = new Set(["updatedAt"]);

type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** A relation include (`patient: {...}`), not a column of the row. */
function isRelation(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    !(v instanceof Date) &&
    !Array.isArray(v)
  );
}

export type RedactedDiff = {
  /** Every column that changed, the name-only ones included. */
  changed: string[];
  /** Old values of the changed columns that may carry values. */
  before: Row;
  /** New values of the changed columns that may carry values. */
  after: Row;
};

/**
 * Update meta: which columns changed, with values only outside `nameOnly`.
 * Pass DECRYPTED rows: a re-saved encrypted value gets a fresh IV, and
 * comparing ciphertext would call it changed. Relation includes on the rows
 * (the case's `patient: { fullName, phone }`) are skipped, they are not
 * what the write changed.
 */
export function redactedDiff(
  before: Row,
  after: Row,
  nameOnly: ReadonlySet<string>,
): RedactedDiff {
  const changed: string[] = [];
  const b: Row = {};
  const a: Row = {};
  for (const key of Object.keys(after)) {
    if (NOISE_FIELDS.has(key)) continue;
    const av = after[key];
    if (isRelation(av) || isRelation(before[key])) continue;
    if (same(before[key], av)) continue;
    changed.push(key);
    if (nameOnly.has(key)) continue;
    b[key] = before[key] ?? null;
    a[key] = av ?? null;
  }
  return { changed, before: b, after: a };
}

export type RedactedSnapshot = {
  /** Name-only columns that held a value. */
  filled: string[];
  /** The other columns with their values. */
  card: Row;
};

/** Create / delete meta: the row's columns, `nameOnly` ones by name. */
export function redactedSnapshot(
  row: Row,
  nameOnly: ReadonlySet<string>,
): RedactedSnapshot {
  const filled: string[] = [];
  const card: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (NOISE_FIELDS.has(key) || isRelation(value)) continue;
    if (nameOnly.has(key)) {
      if (value !== null && value !== undefined && value !== "") filled.push(key);
      continue;
    }
    card[key] = value ?? null;
  }
  return { filled, card };
}

/** `patient.update` meta. */
export function patientUpdateAuditMeta(before: Row, after: Row): RedactedDiff {
  return redactedDiff(before, after, PATIENT_PII_FIELDS);
}

/**
 * `patient.create` / `patient.delete` meta: the card without its identity.
 * The row id is the audit row's `entityId`; `patientNumber` stays, so staff
 * can still tell which card it was.
 */
export function patientSnapshotAuditMeta(row: Row): RedactedSnapshot {
  return redactedSnapshot(row, PATIENT_PII_FIELDS);
}

/**
 * Allergies, diagnoses and chronic conditions on the card (audit G1-07):
 * clinical facts, not identity, so the audit row keeps their values. An
 * edit used to record only the names of the changed fields and a delete
 * only the substance or label, so after «SEVERE anaphylaxis» was changed to
 * MILD, or the allergy removed, nobody could say what the record had said.
 * Now an edit keeps the old and new value of every changed field and a
 * delete keeps the whole row.
 */
const NO_NAME_ONLY: ReadonlySet<string> = new Set();

export function medicalRecordUpdateAuditMeta(
  patientId: string,
  before: Row,
  after: Row,
): { patientId: string } & RedactedDiff {
  return { patientId, ...redactedDiff(before, after, NO_NAME_ONLY) };
}

export function medicalRecordDeleteAuditMeta(
  patientId: string,
  row: Row,
): { patientId: string; deleted: Row } {
  return { patientId, deleted: redactedSnapshot(row, NO_NAME_ONLY).card };
}
