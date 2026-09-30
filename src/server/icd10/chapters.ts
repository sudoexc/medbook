/**
 * How many codes each ICD-10 chapter holds, for the reference page's chapter
 * list. Counted here, on the server, so the page can show the numbers without
 * sending the catalog itself to the browser (audit CT-11): the chapters'
 * codes load one chapter at a time from /api/crm/icd10/search?range=.
 */
import { chapterIdFor } from "@/lib/icd10-chapters";

import { ICD10_ENTRIES } from "./data";

let counts: Record<string, number> | null = null;

export function icd10ChapterCounts(): Record<string, number> {
  if (counts) return counts;
  const out: Record<string, number> = {};
  for (const e of ICD10_ENTRIES) {
    const id = chapterIdFor(e.code);
    if (id) out[id] = (out[id] ?? 0) + 1;
  }
  counts = out;
  return out;
}
