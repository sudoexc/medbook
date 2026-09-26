/**
 * Free-text prescription line → catalog drug, for the CDS engine (audit
 * G4-14).
 *
 * Text lines still reach the engine: doctor presets («Энап 10 мг — по 1 таб
 * 2 раза в день»), protocols without structured items, free rows of the
 * constructor. The first matcher failed them both ways:
 *   - index keys were only lowercased while the line was stripped of
 *     punctuation, so «ЭНАП®», «Но-шпа», «Леводопа + карбидопа» or
 *     «Витамин D3 (холекальциферол)» could never be found, and the card
 *     said «не распознано» for a drug it knew;
 *   - every name was tried before any brand, as a bare `startsWith`, so the
 *     register's short «Лизин» swallowed «Лизинокор» (lisinopril), «АСК»
 *     swallowed «Аскорутин» and «Кардил» swallowed «Кардилопин»: allergy and
 *     interaction checks ran against the wrong substance.
 *
 * Now the line and every key go through one normaliser (`drugNameKey`),
 * a key must cover whole words at the start of the line, and the longest key
 * wins across names, brands and INNs together; on equal length a brand
 * beats a name, which beats an alias. A small tolerance for Russian case
 * endings keeps «Карбамазепина 200 мг» resolving as before, without letting
 * a short name swallow a longer, different word.
 */
import { normalizeCatalogTerm } from "@/server/catalog/formulary";

/**
 * Vitamin tokens are typed both ways: «D3» / «Д3», «B12» / «В12» (the
 * Cyrillic В looks the same). Fold the Latin letter so both spell one key.
 */
const VITAMIN_LETTER: Record<string, string> = {
  a: "а",
  b: "в",
  c: "с",
  d: "д",
  e: "е",
  k: "к",
  p: "р",
};

function foldVitaminToken(tok: string): string {
  const m = /^([a-z])(\d{1,2})$/.exec(tok);
  if (!m) return tok;
  const cyr = VITAMIN_LETTER[m[1]!];
  return cyr ? `${cyr}${m[2]}` : tok;
}

/**
 * The matching key of a drug name or a prescription line: the catalog's own
 * search normalisation (case, ё→е) with ®, ™, quotes, brackets, «+», «-»
 * and every other non-letter folded to single spaces. Both sides of every
 * comparison go through this one function.
 */
export function drugNameKey(raw: string): string {
  return normalizeCatalogTerm(raw)
    .replace(/['’‘ʻʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map(foldVitaminToken)
    .join(" ");
}

export type TextMatchDrug = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode?: string | null;
  brands: { name: string }[];
};

/**
 * How a key names the drug, in tie-break order: a brand, the full name, the
 * name without its bracketed part («Витамин D3»), the INN, and last the
 * bracketed part itself («холекальциферол»).
 */
type Via = "brand" | "name" | "core" | "inn" | "alias";
const VIA_RANK: Record<Via, number> = { brand: 0, name: 1, core: 2, inn: 3, alias: 4 };

type Entry<D> = {
  key: string;
  /** Single-word keys only take part in case-ending tolerance. */
  singleWord: boolean;
  /** What the doctor recognises: the brand or name as written, without ®/™. */
  label: string;
  via: Via;
  drug: D;
};

export type DrugTextIndex<D> = Map<string, Entry<D>[]>;

export type DrugLineMatch<D> = {
  drug: D;
  /** The matched name or brand as the doctor would read it. */
  label: string;
  /**
   * Which name the line used: `brand:<key>` for a brand, `generic` for the
   * drug's own name in any spelling (full, without brackets, INN). Two lines
   * of one drug with different `nameKey`s name it differently («Ибупрофен»,
   * «Нурофен»): the doctor may not see they are the same thing.
   */
  nameKey: string;
};

function toMatch<D>(e: Entry<D>): DrugLineMatch<D> {
  return {
    drug: e.drug,
    label: e.label,
    nameKey: e.via === "brand" ? `brand:${e.key}` : "generic",
  };
}

/** «Депакин®Хроно» → «Депакин Хроно», «ЭНАП®» → «ЭНАП». */
function cleanLabel(s: string): string {
  return s.replace(/[®™]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Index the catalog by the first word of every key. Buckets are ordered
 * longest key first, then by `VIA_RANK`, then a row that carries an ATC code
 * (the curated «Леводопа + карбидопа» with its clinical data over the
 * extension's bare twin of the same name), then by id, so the first key that
 * fits a line is the answer and the order never depends on row order.
 */
export function buildDrugTextIndex<D extends TextMatchDrug>(
  drugs: readonly D[],
): DrugTextIndex<D> {
  const index: DrugTextIndex<D> = new Map();
  const add = (raw: string, via: Via, drug: D, label: string) => {
    const key = drugNameKey(raw);
    if (!key) return;
    const head = key.split(" ")[0]!;
    const bucket = index.get(head) ?? [];
    // Names go in first, so a brand spelled like the drug's own name
    // («Лозартан» registered as a trade name) stays a name.
    if (bucket.some((e) => e.key === key && e.drug.id === drug.id)) return;
    bucket.push({
      key,
      singleWord: !key.includes(" "),
      label: cleanLabel(label),
      via,
      drug,
    });
    index.set(head, bucket);
  };

  for (const d of drugs) {
    add(d.nameRu, "name", d, d.nameRu);
    const core = d.nameRu.replace(/\([^)]*\)/g, " ");
    if (core.trim() && core !== d.nameRu) add(core, "core", d, d.nameRu);
    for (const m of d.nameRu.matchAll(/\(([^)]*)\)/g)) {
      add(m[1]!, "alias", d, d.nameRu);
    }
    // Registry and clinic rows keep a slug in `inn` («uzr:glyukozamin»):
    // not a name anybody types.
    if (!/[_:]/.test(d.inn)) add(d.inn, "inn", d, d.nameRu);
    for (const b of d.brands) add(b.name, "brand", d, b.name);
  }

  for (const bucket of index.values()) {
    bucket.sort(
      (a, b) =>
        b.key.length - a.key.length ||
        VIA_RANK[a.via] - VIA_RANK[b.via] ||
        Number(!a.drug.atcCode) - Number(!b.drug.atcCode) ||
        (a.drug.id < b.drug.id ? -1 : a.drug.id > b.drug.id ? 1 : 0),
    );
  }
  return index;
}

/**
 * Russian case endings a drug name picks up in a written line: «таблетки
 * Карбамазепина», «с Мексидолом». Two letters at most, as in allergy-match.
 */
const CASE_ENDINGS = [
  "ами", "ями", "ом", "ем", "ой", "ей", "ам", "ям", "ах", "ях",
  "а", "я", "у", "ю", "е", "ы", "и",
];
/** Stem length below which no ending is stripped: «аск»+«орутин» stays apart. */
const MIN_STEM = 6;

/**
 * The drug a prescription line names, or null.
 *
 *   1. The longest key that covers whole words at the start of the line
 *      («энап 10 мг» ← «энап»; «лизинокор 10 мг» is not «лизин»).
 *   2. Failing that, the first word as an inflected single-word name
 *      («карбамазепина» ← «карбамазепин»), for stems of six letters or more.
 */
export function matchDrugLine<D extends TextMatchDrug>(
  index: DrugTextIndex<D>,
  line: string,
): DrugLineMatch<D> | null {
  const text = drugNameKey(line);
  if (!text) return null;
  const first = text.split(" ")[0]!;

  for (const e of index.get(first) ?? []) {
    if (text === e.key || text.startsWith(`${e.key} `)) return toMatch(e);
  }

  for (const ending of CASE_ENDINGS) {
    if (!first.endsWith(ending)) continue;
    const stem = first.slice(0, -ending.length);
    if (stem.length < MIN_STEM) continue;
    // «карбамазепин» + «а», but also «кислот» + «ы» for a name ending in «а».
    for (const candidate of [stem, `${stem}а`, `${stem}я`]) {
      const hit = (index.get(candidate) ?? []).find(
        (e) => e.singleWord && e.key === candidate,
      );
      if (hit) return toMatch(hit);
    }
  }
  return null;
}
