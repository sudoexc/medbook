/**
 * The ICD-10 chapters, one list for every screen that browses the catalog:
 * the doctor's reference page and the ICD catalog drawer of the visit.
 *
 * They used to be two lists that disagreed (audit CT-11): the reference page
 * knew 18 chapters and parked 2315 codes (P, Q, V to Y) under a yellow
 * «не классифицированы» banner, while the drawer knew all 21. Chapter U
 * (COVID-19) joined the catalog since (CT-02).
 *
 * Titles are not stored here: they are translated at render time as
 * `doctor.references.icd10.chapters.<id>`, keyed by `id`. The id is the
 * chapter's range as the classifier prints it, and the range the catalog
 * API browses (`/api/crm/icd10/search?range=<id>`).
 *
 * Pure data, no catalog import: client components use it.
 */

export type Icd10Chapter = { id: string };

/** In the classifier's order, chapter I to XXII. */
export const ICD10_CHAPTERS: readonly Icd10Chapter[] = [
  { id: "A00-B99" },
  { id: "C00-D48" },
  { id: "D50-D89" },
  { id: "E00-E90" },
  { id: "F00-F99" },
  { id: "G00-G99" },
  { id: "H00-H59" },
  { id: "H60-H95" },
  { id: "I00-I99" },
  { id: "J00-J99" },
  { id: "K00-K93" },
  { id: "L00-L99" },
  { id: "M00-M99" },
  { id: "N00-N99" },
  { id: "O00-O99" },
  { id: "P00-P96" },
  { id: "Q00-Q99" },
  { id: "R00-R99" },
  { id: "S00-T98" },
  { id: "V01-Y98" },
  { id: "Z00-Z99" },
  { id: "U00-U85" },
];

/** The chapter a neurologist works in: opened first. */
export const DEFAULT_ICD10_CHAPTER = "G00-G99";

/**
 * The chapter of a code, or null for one that is not ICD-10 shaped. By the
 * three-character category, compared with the chapter's bounds: the
 * classifier's categories are uniform «letter + two digits» keys, so a
 * string compare is exact.
 */
export function chapterIdFor(code: string): string | null {
  const key = code.slice(0, 3).toUpperCase();
  if (!/^[A-Z]\d{2}$/.test(key)) return null;
  for (const ch of ICD10_CHAPTERS) {
    const [lo, hi] = ch.id.split("-") as [string, string];
    if (key >= lo && key <= hi) return ch.id;
  }
  return null;
}
