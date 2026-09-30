/**
 * How a typed drug query and a catalog name are compared.
 *
 * The state register spells brands the way the box does: «АСПИРИН® С»,
 * «Токката® рапид», «МАГНЕ® B6» with a Latin B. Doctors type «аспирин с»,
 * «аспирин c» with a Latin c, «токката рапид», «магне в6» with a Cyrillic
 * В. The catalog search matched the whole typed string with one `contains`,
 * so none of those found anything on production (30.09.2026): the ® sat
 * between the words, and a letter that looks the same on screen was another
 * code point.
 *
 * One rule, two tools:
 *   - `foldCatalogText` is the key for everything compared in memory (the
 *     search ranking, the prescription label, the CDS text matcher, the
 *     shortlist): ®, ™, ©, quotes and punctuation become word breaks, and
 *     every Latin letter with a Cyrillic twin becomes that twin, so both
 *     spellings meet.
 *   - The database cannot fold, so `catalogSearchWords` splits a query into
 *     words and `catalogWordVariants` spells each word the few ways the
 *     catalog may hold it: as typed, in Cyrillic, in Latin.
 *
 * Lookalikes are a matter of print, not of spelling. A whole word of them is
 * an ordinary word of its own alphabet: Latin p, c, h, b and y are п, ц, г,
 * б and ю in a slug or an INN, so «нор» is not «hop» nor «тор» «top».
 * Only a lone letter or a letter with digits (the C of «АСПИРИН® С», the B6
 * of «МАГНЕ® B6») is re-spelled for the database, and the Latin id and INN
 * are compared letter for letter (`foldCatalogPlain`).
 *
 * Client-safe (no server imports): the prescription label is built in the
 * browser.
 */

/**
 * Latin letters that have a Cyrillic twin in at least one case. B/В, H/Н,
 * M/М, T/Т and K/К are twins only in capitals, which is how brands are
 * printed («МАГНЕ® B6»), so they are folded after lowercasing all the same.
 */
const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  a: "а",
  b: "в",
  c: "с",
  e: "е",
  h: "н",
  k: "к",
  m: "м",
  o: "о",
  p: "р",
  t: "т",
  x: "х",
  y: "у",
};

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LATIN_TO_CYRILLIC).map(([latin, cyr]) => [cyr, latin]),
);

const LATIN_TWINS = /[abcehkmoptxy]/g;
const CYRILLIC_TWINS = /[авсенкмортху]/g;

/**
 * Apostrophes are part of a word, not a break: Uzbek Latin spells o‘ and g‘
 * with them, and «bo‘g‘im» must stay one word whichever apostrophe was typed.
 */
const APOSTROPHES = /['’‘ʻʼ`]/g;

/**
 * Most words a query is searched by. A pasted paragraph must not turn into
 * a query with a hundred clauses per keystroke.
 */
const MAX_WORDS = 8;

/** Every Latin letter with a Cyrillic twin, as that twin. */
export function toCyrillicTwins(s: string): string {
  return s.replace(LATIN_TWINS, (ch) => LATIN_TO_CYRILLIC[ch]!);
}

/** Every Cyrillic letter with a Latin twin, as that twin. */
export function toLatinTwins(s: string): string {
  return s.replace(CYRILLIC_TWINS, (ch) => CYRILLIC_TO_LATIN[ch]!);
}

/**
 * `foldCatalogText` without the lookalike fold: lowercase, ё→е, ®/™/©,
 * quotes and every other non-letter folded to single spaces, apostrophes
 * dropped, every letter in the alphabet it was written in. The key for the
 * Latin id and INN («hopantenic-acid» → «hopantenic acid»), where folding
 * Latin into Cyrillic made «hopantenic» start with «нор».
 */
export function foldCatalogPlain(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(APOSTROPHES, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The comparison key of a query or a catalog name: `foldCatalogPlain`, then
 * Latin lookalikes in Cyrillic. «АСПИРИН® С», «Аспирин C» and «аспирин с»
 * all give «аспирин с»; «МАГНЕ® B6» and «Магне В6» give «магне в6». Both
 * sides of a comparison go through this one function. For display names
 * and typed lines only: see `foldCatalogPlain` for ids and INNs.
 */
export function foldCatalogText(raw: string): string {
  return toCyrillicTwins(foldCatalogPlain(raw));
}

/**
 * The words of a typed query, as the database is searched for them: case
 * folded, and ®, quotes and punctuation are word breaks («АСПИРИН® С» →
 * «аспирин», «с»; a word that is only a «+» disappears). Apostrophes break
 * too: the catalog's «bo‘g‘im» must be found from a typed «bo'g'im», and
 * each piece is inside it. The alphabet stays as typed; see
 * `catalogWordVariants`.
 */
export function catalogSearchWords(raw: string): string[] {
  const words = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return [...new Set(words)].slice(0, MAX_WORDS);
}

const HAS_LATIN = /\p{Script=Latin}/u;
const HAS_CYRILLIC = /\p{Script=Cyrillic}/u;

/**
 * Whether a typed word may be printed in the other alphabet in the catalog:
 * a lone letter («с» against «АСПИРИН® С» with a Latin C), a letter with
 * digits («в6» against «МАГНЕ® B6», «в12»), or a word that already mixes
 * both, which was a slip. A longer word of one alphabet is that alphabet's
 * word: searching «нор» also as «hop» put «Гопантеновая кислота»
 * (hopantenic-acid) first, «тор» as «top» put «Топирамат» above
 * «Торасемид».
 */
function mayBePrintedInOtherAlphabet(word: string): boolean {
  if ([...word].length === 1 || /\p{N}/u.test(word)) return true;
  return HAS_LATIN.test(word) && HAS_CYRILLIC.test(word);
}

/**
 * The spellings a database search tries for one word in display text
 * (names, brands): as typed (and ё→е), then, for a word that may be printed
 * in the other alphabet (`mayBePrintedInOtherAlphabet`), its all-Cyrillic
 * and its all-Latin form. A form is offered only when the fold reaches a
 * single alphabet: «в6» also looks for «b6», «c» for «с», but «аспирин»
 * is not also searched as «acpиpин», which nothing is spelled like.
 */
export function catalogWordVariants(word: string): string[] {
  const typed = word.toLowerCase();
  const plain = typed.replace(/ё/g, "е");
  const out = [typed, plain];
  if (mayBePrintedInOtherAlphabet(plain)) {
    const cyrillic = toCyrillicTwins(plain);
    if (!HAS_LATIN.test(cyrillic)) out.push(cyrillic);
    const latin = toLatinTwins(plain);
    if (!HAS_CYRILLIC.test(latin)) out.push(latin);
  }
  return [...new Set(out)];
}

/**
 * The spellings tried against a Latin identifier (a drug's id slug and its
 * INN): `catalogWordVariants` without the Latin re-spelling of a Cyrillic
 * word. In «hopantenic», «cetirizine» the c, p, h are ц, п, г, so a typed
 * «с» or «р» there is no lookalike and must not pull those rows in. A Latin
 * word typed with one Cyrillic slip still reaches its INN.
 */
export function catalogWordIdVariants(word: string): string[] {
  const variants = catalogWordVariants(word);
  if (HAS_LATIN.test(word)) return variants;
  return variants.filter((v) => !HAS_LATIN.test(v));
}

/**
 * A query word that mixes alphabets («мигрeнь» with a Latin e) was typed
 * with a lookalike by mistake: its Latin twins go Cyrillic. Words in one
 * alphabet are left alone, Latin terms («cholerae») included.
 */
export function foldMixedWords(text: string): string {
  return text.replace(/[\p{L}\p{N}]+/gu, (w) =>
    /\p{Script=Latin}/u.test(w) && /\p{Script=Cyrillic}/u.test(w)
      ? toCyrillicTwins(w)
      : w,
  );
}
