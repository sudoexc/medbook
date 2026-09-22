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

/**
 * What the doctor says → what the classifier calls it.
 *
 * The register's wording is official; the clinic's is spoken. «Цефалгия»,
 * «ВСД», «ДЭП», «грыжа диска» return NOTHING against the raw catalog, which
 * is exactly the «не могу найти нужный диагноз» the neurologist reported —
 * the code is in there, under a name nobody uses out loud. Each entry maps a
 * spoken form to terms that DO appear in ICD-10 names; matches from an
 * expansion are ranked below a literal hit (see SCORE.synonym).
 *
 * Neurology-first, because that is this clinic. Extend freely: a wrong
 * expansion only adds a candidate the doctor can ignore, a missing one costs
 * them the search.
 */
const SYNONYMS: Record<string, string[]> = {
  цефалгия: ["головная боль"],
  цефалгии: ["головная боль"],
  всд: ["расстройство вегетативной нервной системы"],
  вегетососудистая: ["расстройство вегетативной нервной системы"],
  "вегето-сосудистая": ["расстройство вегетативной нервной системы"],
  дэп: ["цереброваскулярная болезнь"],
  дисциркуляторная: ["цереброваскулярная болезнь"],
  "грыжа диска": ["поражение межпозвоночного диска"],
  "межпозвоночная грыжа": ["поражение межпозвоночного диска"],
  протрузия: ["поражение межпозвоночного диска"],
  онмк: ["инфаркт мозга"],
  тиа: ["преходящие транзиторные церебральные ишемические"],
  "защемление нерва": ["сдавления нервных корешков"],
  "ущемление нерва": ["сдавления нервных корешков"],
  прострел: ["люмбаго"],
  бессонница: ["нарушения засыпания"],
  инсомния: ["нарушения засыпания"],
  "паническая атака": ["паническое расстройство"],
  "сотрясение мозга": ["внутричерепная травма"],
};

/**
 * Terms the catalog might actually contain for a spoken word.
 *
 * `direct` = the whole query IS a known spoken form («грыжа диска»). That is
 * a strong signal and must outrank literal partial matches, otherwise
 * «грыжа диска» keeps answering with abdominal hernias just because they
 * happen to contain the word «грыжа».
 */
export function expandSynonyms(term: string): { terms: string[]; direct: boolean } {
  const exact = SYNONYMS[term];
  if (exact) return { terms: exact, direct: true };
  const out: string[] = [];
  for (const [spoken, official] of Object.entries(SYNONYMS)) {
    if (term.includes(spoken)) out.push(...official);
  }
  return { terms: out, direct: false };
}

/**
 * Words that match everything and therefore mean nothing here. Without this
 * «прострел в пояснице» scored every row carrying «в» — the search answered
 * with cholera.
 */
const STOP_WORDS = new Set([
  "в", "во", "и", "с", "со", "на", "по", "при", "для", "без", "от", "до",
  "из", "у", "к", "о", "об", "не", "или",
]);

/** Query words worth matching on: not stop words, long enough to mean it. */
function significantWords(words: string[]): string[] {
  const kept = words.filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return kept.length > 0 ? kept : words;
}

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
  /**
   * Reached through a spoken-form synonym. `synonymDirect` applies when the
   * whole query is a known spoken form — it must beat partial literal
   * matches (which top out near `nameStarts`), because a doctor typing
   * «грыжа диска» means the disc, not the groin.
   */
  synonymDirect: 70,
  synonym: 15,
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

  const words = significantWords(term.split(" ").filter(Boolean));

  const full: { entry: Icd10Entry; score: number; code: string }[] = [];
  const partial: { entry: Icd10Entry; score: number; code: string }[] = [];
  for (const row of rows) {
    if (words.length > 1) {
      // Partial matching, but full matches always win. Requiring every word
      // meant «остеохондроз шейного отдела» returned NOTHING while
      // «остеохондроз» alone returned 17 codes — the classifier does not
      // spell the region the way the doctor does. Ranking by how many words
      // matched surfaces the right rubric instead of an empty list, and the
      // full-match bucket keeps precise queries precise.
      const matched = words.filter((w) => wordMatches(row, w));
      if (matched.length === 0) continue;
      const base = scoreOne(row, words[0]!);
      if (matched.length === words.length) {
        full.push({ entry: row.entry, score: base + words.length, code: row.code });
      } else {
        partial.push({
          entry: row.entry,
          score: base * (matched.length / words.length) + matched.length,
          code: row.code,
        });
      }
    } else {
      const score = scoreOne(row, term);
      if (score === 0) continue;
      full.push({ entry: row.entry, score, code: row.code });
    }
  }

  const scored = full.length > 0 ? full : partial;

  // What the doctor MEANT: «цефалгия» → «головная боль». Always attempted,
  // not only when the literal search came back empty — a spoken form often
  // has noisy literal matches («грыжа» → паховые грыжи) that would
  // otherwise bury the rubric actually being asked for. The expansion is
  // matched as a whole phrase so it can never drag in a rubric that merely
  // shares one common word.
  {
    const { terms: expansions, direct } = expandSynonyms(term);
    const synScore = direct ? SCORE.synonymDirect : SCORE.synonym;
    // By code, so a rubric the literal pass already found WEAKLY gets
    // promoted rather than skipped: «грыжа диска» literally matches M50 on
    // the single word «диска» (a low partial score) while «грыжа» matches
    // every abdominal hernia strongly — without promotion the right answer
    // stays buried under the groin.
    const byCode = new Map(scored.map((x) => [x.code, x]));
    for (const alt of expansions) {
      const altTerm = normalizeIcdTerm(alt);
      const altWords = significantWords(altTerm.split(" ").filter(Boolean));
      for (const row of rows) {
        const hit =
          altWords.length > 1
            ? altWords.every((w) => row.name.includes(w))
            : row.name.includes(altTerm);
        if (!hit) continue;
        const existing = byCode.get(row.code);
        if (existing) {
          existing.score = Math.max(existing.score, synScore);
          continue;
        }
        const added = { entry: row.entry, score: synScore, code: row.code };
        byCode.set(row.code, added);
        scored.push(added);
      }
    }
  }

  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  return scored.slice(0, limit).map((s) => s.entry);
}

