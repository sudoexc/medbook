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
 *
 * 10414 codes across 25 chapters.
 */
import entries from "./data.json";

export type Icd10Entry = {
  code: string;
  nameRu: string;
};

export const ICD10_ENTRIES: Icd10Entry[] = entries;
