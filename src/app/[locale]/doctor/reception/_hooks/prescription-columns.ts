/**
 * What the prescription picker's three columns show (clinic request
 * 03.10.2026: prescribe with the mouse, no typing).
 *
 *   «Частые»  — what this doctor writes most (the server's `frequent`);
 *   «Мои»     — what he starred, in his order (`starredColumn`);
 *   «Каталог» — the catalog walked by clicks: the drugs usual for the main
 *               diagnosis, the clinic's core list, then ATC group →
 *               subgroup → drugs (`catalogRootGroups`, `atcSubgroups`).
 *
 * Pure: the picker renders these, the tests drive them.
 */
import { ATC_GROUPS, ATC_SUBGROUPS } from "@/lib/catalogs/atc-groups";
import { foldCatalogText } from "@/lib/catalogs/search-fold";
import {
  drugNameForms,
  lineWords,
  wordsNameDrug,
} from "@/lib/catalogs/line-names-drug";

import { shortItemFromDrug, splitFreeLine } from "./prescription-rows";
import type { DrugSearchHit } from "./use-drug-search";
import type { DrugShortItem, DrugUsual } from "./use-shortlists";

/**
 * Whether a picker item is already on the visit: by drug id, or by its name
 * under the catalog search's fold («Магне® B6» on screen is the «Магне В6»
 * of his list). Items on the visit stay where they are, marked: hiding them
 * moved the list under the doctor's cursor, and his next click landed on
 * the drug below.
 *
 * A text line and a row of one drug are one drug too (review of
 * 03.10.2026): an item that is a line («Мексидол 5,0 в/м №10», from his
 * history or «Обычно при») is on the visit once a row of the drug it names
 * is, and a drug is on it once a text line names it (line-names-drug.ts).
 * Before, only whole lines compared, so «Добавить всё» put a drug on the
 * sheet as a row and again as a line.
 */
export function onVisitChecker(
  rows: ReadonlyArray<{ drugId: string | null; displayName: string }>,
  legacy: readonly string[],
): (item: { drugId: string | null; label: string }) => boolean {
  const ids = new Set(rows.map((r) => r.drugId).filter((id): id is string => !!id));
  const names = new Set(
    [...rows.map((r) => r.displayName), ...legacy]
      .map(foldCatalogText)
      // A line of dashes folds to nothing: it names no drug.
      .filter(Boolean),
  );
  // Folded once here: the picker asks about every item of three columns.
  const rowForms = rows.flatMap((r) => drugNameForms(r.displayName));
  const legacyWords = legacy.map(lineWords).filter((w) => w.length > 0);
  return (item) => {
    if (item.drugId && ids.has(item.drugId)) return true;
    const name = splitFreeLine(item.label).name;
    if (names.has(foldCatalogText(item.label)) || names.has(foldCatalogText(name))) {
      return true;
    }
    if (rowForms.length > 0 && wordsNameDrug(lineWords(item.label), rowForms)) {
      return true;
    }
    if (legacyWords.length === 0) return false;
    const forms = drugNameForms(name);
    return legacyWords.some((words) => wordsNameDrug(words, forms));
  };
}

/**
 * «Мои»: his stars in his order, each with the data a click needs.
 *
 * `favorites` is the starred list as the favourites hook holds it, which a
 * click updates at once; null while it loads, and then the server's
 * `starred` list stands in. A drug starred a moment ago is not in the
 * shortlist the server sent: it is found among the drugs the picker has
 * shown (`seen`), with his usual dose when he has one. A star with nothing
 * to show yet (starred in the «Каталог» window) waits for the next
 * shortlist, which the star itself asks for once it is saved
 * (use-doctor-favorites.ts).
 */
export function starredColumn(args: {
  favorites: readonly string[] | null;
  starred: readonly DrugShortItem[];
  /** Other lists from the same answer (frequent, core): same data, by id. */
  known: readonly DrugShortItem[];
  seen: ReadonlyMap<string, DrugSearchHit>;
  usual: Readonly<Record<string, DrugUsual>>;
}): DrugShortItem[] {
  if (args.favorites === null) {
    return args.starred.map((i) => ({ ...i, pinned: true }));
  }
  const byId = new Map<string, DrugShortItem>();
  for (const item of [...args.known, ...args.starred]) {
    if (item.drugId && item.drug) byId.set(item.drugId, item);
  }
  const out: DrugShortItem[] = [];
  const seenIds = new Set<string>();
  for (const id of args.favorites) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const item = byId.get(id);
    if (item) {
      out.push({ ...item, pinned: true });
      continue;
    }
    const drug = args.seen.get(id);
    if (drug) out.push(shortItemFromDrug(drug, args.usual[id], { pinned: true }));
  }
  return out;
}

export type CatalogGroup =
  /** «При G43.0»: catalog drugs whose indications match the main diagnosis. */
  | { kind: "diagnosis"; code: string; count: number }
  /** «Основные препараты клиники». */
  | { kind: "core"; count: number }
  /** An ATC main group; `count` is null when the counts did not load. */
  | { kind: "atc"; code: string; count: number | null };

/**
 * The «Каталог» column's first level: what is usual for this diagnosis and
 * the clinic's own list first (they are what a doctor reaches for), then
 * the ATC main groups that hold anything.
 */
export function catalogRootGroups(args: {
  diagnosisCode: string | null;
  diagnosisCount: number;
  coreCount: number;
  /** Drugs per ATC letter; undefined when the counts are not available. */
  byGroup: Readonly<Record<string, number>> | undefined;
}): CatalogGroup[] {
  const out: CatalogGroup[] = [];
  const code = args.diagnosisCode?.trim().toUpperCase();
  if (code && args.diagnosisCount > 0) {
    out.push({ kind: "diagnosis", code, count: args.diagnosisCount });
  }
  if (args.coreCount > 0) out.push({ kind: "core", count: args.coreCount });
  for (const g of ATC_GROUPS) {
    if (!args.byGroup) {
      out.push({ kind: "atc", code: g.code, count: null });
      continue;
    }
    const count = args.byGroup[g.code] ?? 0;
    if (count > 0) out.push({ kind: "atc", code: g.code, count });
  }
  return out;
}

/**
 * The subgroups of one ATC main group that hold drugs, in code order. A
 * prefix the gloss table lacks still shows (by its code): the drugs are
 * there. Without counts (an older server) the table's subgroups stand in.
 */
export function atcSubgroups(
  letter: string,
  bySubgroup: Readonly<Record<string, number>> | undefined,
): { code: string; count: number | null }[] {
  const l = letter.trim().toUpperCase().charAt(0);
  if (!l) return [];
  if (!bySubgroup) {
    return ATC_SUBGROUPS.filter((g) => g.code.startsWith(l)).map((g) => ({
      code: g.code,
      count: null,
    }));
  }
  return Object.entries(bySubgroup)
    .filter(([code, n]) => code.startsWith(l) && n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => ({ code, count }));
}
