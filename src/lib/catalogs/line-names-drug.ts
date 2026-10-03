/**
 * Does a free-text prescription line name a drug?
 *
 * A drug reaches a visit as a structured row («Мексидол», by its catalog id)
 * or as a text line from a preset, a protocol or an older note («Мексидол
 * 5,0 в/м №10»). Both are one drug: «Обычно при <диагноз>» must not offer it
 * twice, «Добавить всё» must not add it twice, and the picker marks it as on
 * the visit either way (review of 03.10.2026). The whole line never equals
 * the row's name, so the comparison is the one the treatment diff makes
 * (audit VW-05): the line starts with one of the drug's names as whole
 * words (the label, the label without its bracket, what the bracket holds:
 * «Мидокалм (толперизон)»).
 *
 * Stricter than the diff on one point: what follows the name must be the
 * dose, not more of a name, because here a match hides a drug from a click.
 * A number, a short word or a dosing word («в/м», «по», «амп», «таб») is the
 * dose; a word with a letter and a digit («B6», «D3») or any other longer
 * word carries on the name: «Магний B6» is not «Магний», «Нурофен плюс» is
 * not «Нурофен».
 *
 * Words go through the catalog search's fold, so «Магне® В6» (Cyrillic В)
 * and «Магне B6» compare equal. Pure: the server's memory builder and the
 * picker share it.
 */
import { foldCatalogText } from "./search-fold";

/** Words after a name that belong to the dose, not to the name. */
const DOSE_WORDS = new Set([
  "таб",
  "табл",
  "таблетка",
  "таблетки",
  "капс",
  "капсула",
  "капсулы",
  "кап",
  "капли",
  "амп",
  "ампула",
  "ампулы",
  "мг",
  "мл",
  "мкг",
  "ед",
  "раствор",
  "сироп",
  "мазь",
  "гель",
  "крем",
  "спрей",
  "свечи",
  "порошок",
  "суспензия",
  "саше",
  "по",
  "внутрь",
  "утром",
  "днем",
  "вечером",
  "на",
  "ночь",
  "раз",
  "раза",
  "курс",
  "ежедневно",
  "натощак",
]);

/** Whether a word right after a drug's name goes on with the name. */
function continuesName(word: string): boolean {
  if (/^\p{N}/u.test(word)) return false;
  if (/\p{N}/u.test(word)) return true;
  if (word.length <= 2 || DOSE_WORDS.has(word)) return false;
  return true;
}

/** A line's words under the catalog fold. */
export function lineWords(line: string): string[] {
  return foldCatalogText(line).split(" ").filter(Boolean);
}

/**
 * The names a drug goes by, as folded words: its label, the label without
 * the bracket, and what each bracket holds.
 */
export function drugNameForms(displayName: string): string[][] {
  const names = [displayName, displayName.replace(/\([^)]*\)/g, " ")];
  for (const m of displayName.matchAll(/\(([^)]*)\)/g)) names.push(m[1]!);
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const words = lineWords(name);
    const key = words.join(" ");
    if (words.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(words);
  }
  return out;
}

/** `lineNamesDrug` on words already folded (lists compare many pairs). */
export function wordsNameDrug(
  line: readonly string[],
  forms: readonly (readonly string[])[],
): boolean {
  return forms.some(
    (name) =>
      name.length <= line.length &&
      name.every((w, i) => line[i] === w) &&
      (line.length === name.length || !continuesName(line[name.length]!)),
  );
}

export function lineNamesDrug(line: string, displayName: string): boolean {
  return wordsNameDrug(lineWords(line), drugNameForms(displayName));
}
