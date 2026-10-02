/**
 * A patient row as the list endpoint hands it out (audit PT-11).
 *
 * GET /api/crm/patients serves the patients table, the booking and walk-in
 * pickers, the doctor's search and the Telegram rail, to every role up to
 * 200 rows a page. It used to return each card whole with the passport and
 * the notes decrypted, so a call operator could page through the whole
 * base's passports. None of those screens shows them: the card itself
 * (GET /api/crm/patients/[id]) is where they are read and edited. The
 * search by passport runs in the database and reaches only legacy
 * plaintext passports (audit PT-26, `patientSearchWhere`).
 */

/** Never in a list row: identity documents and free text about the person. */
const LIST_OMITTED_FIELDS = [
  "passport",
  "notes",
  "summaryCache",
  "summaryCacheUpdatedAt",
] as const;

export type PatientListRow<T> = Omit<T, (typeof LIST_OMITTED_FIELDS)[number]>;

export function toPatientListRow<T extends Record<string, unknown>>(
  row: T,
): PatientListRow<T> {
  const out: Record<string, unknown> = { ...row };
  for (const key of LIST_OMITTED_FIELDS) delete out[key];
  return out as PatientListRow<T>;
}
