/**
 * Ranked ICD-10 lookup.
 *
 * The catalog went from a hand-curated 465 entries to the full 10 414, which
 * breaks the old approach rather than improving it: scanning in catalog order
 * and stopping at the first N matches returns whatever sorts earliest by code,
 * not what the doctor meant. Typing «мигрень» would surface codes from chapter
 * A before the migraine ones in G43.
 *
 * So matches are scored and the best ones win. The tiers, highest first:
 *   - exact code            («G43.0» → G43.0)
 *   - code prefix           («G43»   → G43.0, G43.1, …)
 *   - name starts with term («мигрень» → «Мигрень без ауры»)
 *   - a word in the name starts with term («аура» → «Мигрень с аурой»)
 *   - term appears anywhere in the name
 * Ties break on code so the order is stable between identical queries.
 *
 * Multi-word queries require every word to match somewhere — «мигрень аура»
 * narrows instead of widening, which is how people expect search to behave.
 *
 * Normalisation folds ё→е and case. Cyrillic ё is typed inconsistently and
 * costing a doctor a result over a diacritic is not acceptable mid-visit.
 */
import { ICD10_ENTRIES, type Icd10Entry } from "./data";

export function normalizeIcdTerm(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/**
 * Russian case endings, longest first so "ами" strips before "ми".
 *
 * Not a real stemmer — deliberately. A doctor types «аура» while the
 * classifier says «с аурой»; plain substring matching fails there, because
 * "аурой" does not contain "аура". Chopping a suffix off both sides makes
 * them meet at "аур". Getting this wrong costs a missed diagnosis code
 * mid-visit, so the list stays conservative: only endings that are almost
 * always inflection, and only on words long enough that the stem survives.
 */
const RU_ENDINGS = [
  "ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими", "ей", "ой", "ый",
  "ий", "ая", "яя", "ое", "ее", "ые", "ие", "ов", "ев", "ам", "ям", "ах",
  "ях", "ом", "ем", "у", "ю", "а", "я", "ы", "и", "е", "о", "ь",
];

/**
 * Strip inflectional endings down to a stable stem, keeping ≥3 characters.
 *
 * Applied repeatedly rather than once, because one pass is not idempotent and
 * that breaks matching asymmetrically: «переломами» reduces to «перелом»,
 * which still ends in a listed ending, while a query of «перелом» would have
 * stopped there. The two sides then never meet. Looping to a fixed point makes
 * both land on the same stem regardless of which form was typed.
 */
export function stemRu(word: string): string {
  let cur = word;
  // Bounded: every iteration shortens the string, so it cannot spin.
  for (;;) {
    if (cur.length <= 3) return cur;
    const end = RU_ENDINGS.find(
      (e) => cur.length - e.length >= 3 && cur.endsWith(e),
    );
    if (!end) return cur;
    cur = cur.slice(0, -end.length);
  }
}

/**
 * Pre-normalised mirror of the catalog, built once per process. 10k rows is
 * cheap to hold but not cheap to lowercase on every keystroke of every
 * doctor — and the picker fires on each character.
 */
type Indexed = {
  entry: Icd10Entry;
  code: string;
  name: string;
  /** Word starts inside the name, for prefix-of-word matching. */
  words: string[];
  /** Same words with case endings stripped — see `stemRu`. */
  stems: string[];
};

let index: Indexed[] | null = null;

function getIndex(): Indexed[] {
  if (index) return index;
  index = ICD10_ENTRIES.map((entry) => {
    const name = normalizeIcdTerm(entry.nameRu);
    const words = name.split(/[^a-zа-я0-9]+/i).filter(Boolean);
    return {
      entry,
      code: entry.code.toLowerCase(),
      name,
      words,
      stems: words.map(stemRu),
    };
  });
  return index;
}

/** True when a query word matches a word of the name, allowing inflection. */
function wordMatches(row: Indexed, word: string): boolean {
  if (row.name.includes(word) || row.code.includes(word)) return true;
  const stem = stemRu(word);
  return row.stems.some((s) => s === stem || s.startsWith(stem));
}

const SCORE = {
  exactCode: 100,
  codePrefix: 80,
  nameStarts: 60,
  wordStarts: 40,
  contains: 20,
  /** Matched only after stripping a case ending — correct, but weakest. */
  inflected: 10,
} as const;

function scoreOne(row: Indexed, term: string): number {
  if (row.code === term) return SCORE.exactCode;
  if (row.code.startsWith(term)) return SCORE.codePrefix;
  if (row.name.startsWith(term)) return SCORE.nameStarts;
  if (row.words.some((w) => w.startsWith(term))) return SCORE.wordStarts;
  if (row.name.includes(term)) return SCORE.contains;
  // Last resort: the same word in another case («аура» vs «аурой»).
  const stem = stemRu(term);
  if (row.stems.some((s) => s === stem || s.startsWith(stem))) {
    return SCORE.inflected;
  }
  return 0;
}

export function searchIcd10(rawQuery: string, limit: number): Icd10Entry[] {
  const term = normalizeIcdTerm(rawQuery);
  const rows = getIndex();

  if (!term) {
    // No query: the picker still wants something on screen. Catalog order
    // starts at chapter A (infectious disease), which is noise for most
    // clinics — return nothing rather than a misleading default, and let the
    // UI show its hint instead.
    return [];
  }

  const words = term.split(" ").filter(Boolean);

  const scored: { entry: Icd10Entry; score: number; code: string }[] = [];
  for (const row of rows) {
    // Every word must appear somewhere, otherwise a second word would widen
    // the result set instead of narrowing it.
    if (words.length > 1) {
      if (!words.every((w) => wordMatches(row, w))) continue;
    }
    // Rank on the full term when it is one word; on the first word otherwise,
    // since that is what the doctor started typing.
    const score = scoreOne(row, words.length > 1 ? words[0]! : term);
    if (score === 0) continue;
    scored.push({ entry: row.entry, score, code: row.code });
  }

  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  return scored.slice(0, limit).map((s) => s.entry);
}

