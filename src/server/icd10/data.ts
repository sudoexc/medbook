/**
 * Full ICD-10 catalog (Russian). The payload lives in `data.json`; this file
 * only types it. Both are generated — do not hand-edit either.
 *
 * Regenerate with:
 *   curl -sL -o /tmp/mkb_data.sql \
 *     https://raw.githubusercontent.com/lensws/mkb10/master/sql/mkb_data.sql
 *   node scripts/build-icd10-catalog.mjs /tmp/mkb_data.sql
 *
 * Only leaf codes are included — chapter and block headings ("A00-B99
 * Некоторые инфекционные болезни") are not diagnoses a doctor writes down.
 * A leaf whose own wording only continues its category («Головного мозга над
 * мозговым наметом») carries the category's words, so every name is a
 * diagnosis on its own and no two codes share one. Categories the book
 * subdivides in a block note (E10-E14) carry those subcategories, and the
 * COVID-19 codes of chapter U, which the dump predates, are added.
 *
 * Server code only: the payload is 1.4 MB, and a client component that
 * imports it ships all of it to the browser (audit CT-11). Browsers read the
 * catalog through /api/crm/icd10/search.
 *
 * 10465 codes across 26 chapters.
 */
import entries from "./data.json";

export type Icd10Entry = {
  code: string;
  nameRu: string;
};

export const ICD10_ENTRIES: Icd10Entry[] = entries;
