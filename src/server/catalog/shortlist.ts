/**
 * «Мои частые» — what a doctor sees on tapping the diagnosis or drug field
 * before typing anything.
 *
 * The clinic's request (25.09.2026): every doctor has his own handful of
 * diagnoses and drugs he writes again and again (one lives on migraine and
 * tension headache, another on lumbago); those must be one tap away, and
 * everything else stays out of sight until he searches for it.
 *
 * Pure functions: the routes feed them rows, the tests feed them arrays.
 *
 * Ranking, both lists:
 *   1. what the doctor starred, in his own order;
 *   2. what he actually wrote, most often first, ties to the most recent.
 * Counted over drafts too: in this clinic most visits are never signed, and
 * a list built from signed notes alone would be empty for the busiest doctor.
 */
import { prescriptionLabel } from "@/lib/catalogs/brand-match";
import { foldCatalogText } from "@/lib/catalogs/search-fold";
import { parseAdditionalDiagnoses } from "@/lib/visit-diagnoses";
import { normalizeCatalogTerm } from "@/server/catalog/formulary";
import {
  buildDrugTextIndex,
  matchDrugLine,
  type DrugTextIndex,
  type TextMatchDrug,
} from "@/server/cds/drug-text-match";

/**
 * However many stars a doctor has, this much of his real history still
 * shows: a long favourites list must not hide what he writes every day.
 */
const MIN_HISTORY = 5;

function withHistory<T>(pinned: T[], rest: T[], limit: number): T[] {
  return [
    ...pinned,
    ...rest.slice(0, Math.max(limit - pinned.length, MIN_HISTORY)),
  ];
}

// ───────────────────────── Diagnoses ─────────────────────────

export type DiagnosisUse = {
  code: string | null;
  name: string | null;
  at: Date;
};

/**
 * Every diagnosis a note records, one use each: the main one and the others
 * after it (a visit has up to four). The tension headache he writes as the
 * second diagnosis of every migraine visit is one of his frequent ones too.
 */
export function noteDiagnosisUses(note: {
  diagnosisCode: string | null;
  diagnosisName: string | null;
  additionalDiagnoses?: unknown;
  createdAt: Date;
}): DiagnosisUse[] {
  return [
    { code: note.diagnosisCode, name: note.diagnosisName, at: note.createdAt },
    ...parseAdditionalDiagnoses(note.additionalDiagnoses).map((d) => ({
      code: d.code,
      name: d.name,
      at: note.createdAt,
    })),
  ];
}

export type DiagnosisShortItem = {
  code: string | null;
  name: string;
  count: number;
  pinned: boolean;
};

/** ICD codes group case-insensitively; free text groups by wording. */
function diagnosisKey(code: string | null, name: string): string {
  const c = code?.trim().toUpperCase();
  return c ? `code:${c}` : `text:${normalizeCatalogTerm(name)}`;
}

/**
 * The wording to offer for a code. Until the catalog carried its parent's
 * words (audit CT-06), a leaf was stored as the bare tail of its category
 * («Головного мозга над мозговым наметом» for D33.0), and a shortlist built
 * from those notes would keep putting it back into new conclusions. A stored
 * wording that is exactly the end of the catalog's current name is that old
 * fragment: the full name replaces it. Any other wording of his is left
 * alone; the rare one that is also such a tail («мигрень» for G43.8 «Другая
 * мигрень») becomes the name of the code he picked, which it stood for.
 */
function currentWording(
  code: string | null,
  stored: string,
  nameForCode: (code: string) => string | null,
): string {
  if (!code) return stored;
  const current = nameForCode(code.toUpperCase());
  if (!current) return stored;
  const full = normalizeCatalogTerm(current);
  const own = normalizeCatalogTerm(stored);
  return full.length > own.length && full.endsWith(` ${own}`) ? current : stored;
}

type DiagnosisAcc = DiagnosisShortItem & { lastAt: number };

/**
 * One entry per diagnosis he wrote, with how often and his newest wording.
 * Shared by the shortlist and the picker's columns so the two can never
 * count differently.
 */
function accumulateDiagnosisUses(
  uses: readonly DiagnosisUse[],
  nameForCode: (code: string) => string | null,
): Map<string, DiagnosisAcc> {
  const acc = new Map<string, DiagnosisAcc>();
  // Newest first, so the first wording seen for a code is the current one.
  const sorted = [...uses].sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const u of sorted) {
    const name = u.name?.trim();
    if (!name) continue;
    const code = u.code?.trim() || null;
    const key = diagnosisKey(code, name);
    const cur = acc.get(key);
    if (cur) {
      cur.count += 1;
      continue;
    }
    acc.set(key, {
      code: code ? code.toUpperCase() : null,
      name: currentWording(code, name, nameForCode),
      count: 1,
      pinned: false,
      lastAt: u.at.getTime(),
    });
  }
  return acc;
}

/** Most often first, ties to the most recent. */
function rankedDiagnoses(acc: ReadonlyMap<string, DiagnosisAcc>): DiagnosisShortItem[] {
  return [...acc.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .map((a) => ({ code: a.code, name: a.name, count: a.count, pinned: a.pinned }));
}

/** A starred code with his count and wording, or the catalog's; null if nobody can name it. */
function starredDiagnosis(
  raw: string,
  acc: ReadonlyMap<string, DiagnosisAcc>,
  nameForCode: (code: string) => string | null,
): DiagnosisShortItem | null {
  const code = raw.trim().toUpperCase();
  if (!code) return null;
  const used = acc.get(`code:${code}`);
  if (used) return { code, name: used.name, count: used.count, pinned: true };
  const name = nameForCode(code);
  return name ? { code, name, count: 0, pinned: true } : null;
}

export function buildDiagnosisShortlist(args: {
  /** Starred ICD codes, in the doctor's order. */
  pinnedCodes: string[];
  uses: DiagnosisUse[];
  /**
   * The catalog's wording for a code: for a starred code he never used yet,
   * and to replace a stored fragment of it (see `currentWording`).
   */
  nameForCode: (code: string) => string | null;
  limit: number;
}): DiagnosisShortItem[] {
  const acc = accumulateDiagnosisUses(args.uses, args.nameForCode);

  const pinned: DiagnosisShortItem[] = [];
  for (const raw of args.pinnedCodes) {
    const item = starredDiagnosis(raw, acc, args.nameForCode);
    if (!item) continue;
    acc.delete(`code:${item.code}`);
    pinned.push(item);
  }

  return withHistory(pinned, rankedDiagnoses(acc), args.limit);
}

export type DiagnosisColumns = {
  /**
   * «Частые»: what he actually writes, most often first, starred or not
   * (`pinned` marks the stars). Unlike the shortlist, a star never pushes
   * history out of this column: the two columns answer different questions.
   */
  frequent: DiagnosisShortItem[];
  /** «Мои»: his starred codes in his order, each named. */
  starred: DiagnosisShortItem[];
};

/**
 * The diagnosis picker's «Частые» and «Мои» columns (clinic request
 * 03.10.2026: the diagnosis picked with the mouse, three columns side by
 * side). Same counting as the shortlist: drafts included, every diagnosis of
 * a note (the main one and the others), newest wording wins.
 */
export function buildDiagnosisColumns(args: {
  pinnedCodes: string[];
  uses: DiagnosisUse[];
  nameForCode: (code: string) => string | null;
  frequentLimit: number;
}): DiagnosisColumns {
  const acc = accumulateDiagnosisUses(args.uses, args.nameForCode);
  const pinnedSet = new Set(args.pinnedCodes.map((c) => c.trim().toUpperCase()));
  const frequent = rankedDiagnoses(acc)
    .slice(0, args.frequentLimit)
    .map((d) => ({ ...d, pinned: !!d.code && pinnedSet.has(d.code) }));
  const starred: DiagnosisShortItem[] = [];
  const seen = new Set<string>();
  for (const raw of args.pinnedCodes) {
    const item = starredDiagnosis(raw, acc, args.nameForCode);
    if (!item?.code || seen.has(item.code)) continue;
    seen.add(item.code);
    starred.push(item);
  }
  return { frequent, starred };
}

// ───────────────────────── Drugs ─────────────────────────

export type StructuredDrugUse = {
  drugId: string | null;
  displayName: string;
  dose: string | null;
  /** The row's form and strength: the dose was written for them. */
  form?: string | null;
  strength?: string | null;
  /**
   * The schedule written with that dose: times of day, meal relation and
   * days. Optional: callers that only rank (the CT-03 repin) leave it out.
   */
  timesOfDay?: readonly string[] | null;
  mealRelation?: string | null;
  durationDays?: number | null;
  at: Date;
};

export type DrugShortItem = {
  /** drugId for catalog rows, `text:<label>` for free-typed ones. */
  key: string;
  drugId: string | null;
  label: string;
  count: number;
  lastDose: string | null;
  /**
   * Form and strength of the row his last dose belongs to (audit G4-07): a
   * «мои частые» pick comes back as he wrote it, not as the catalog's
   * first form (citicoline drops, not the injection listed first).
   */
  lastForm: string | null;
  lastStrength: string | null;
  /**
   * The schedule of that same row (clinic request 03.10.2026: one click
   * must bring the drug back with his usual dose AND schema, so a doctor
   * who works with the mouse does not set «утро, вечер, 10 дней» again on
   * every visit). Empty / null when that row had none.
   */
  lastTimesOfDay: string[];
  lastMealRelation: string | null;
  lastDurationDays: number | null;
  pinned: boolean;
};

type DrugAcc = DrugShortItem & { lastAt: number };

/**
 * One entry per drug he wrote: structured rows by drug id, free-typed ones
 * by the search's fold of their wording. Shared by the shortlist and the
 * picker columns so the two can never count differently.
 */
function accumulateDrugUses(
  structured: readonly StructuredDrugUse[],
  freeText: readonly { line: string; at: Date }[],
): Map<string, DrugAcc> {
  const acc = new Map<string, DrugAcc>();

  const bump = (
    key: string,
    drugId: string | null,
    label: string,
    use: Omit<StructuredDrugUse, "drugId" | "displayName">,
  ) => {
    const dose = use.dose?.trim() || null;
    // The form, strength and schedule travel with the dose they were
    // written for: a dose from one visit with the times of another is a
    // prescription he never wrote.
    const takeDose = (cur: DrugAcc) => {
      cur.lastDose = dose;
      cur.lastForm = use.form ?? null;
      cur.lastStrength = use.strength ?? null;
      cur.lastTimesOfDay = [...(use.timesOfDay ?? [])];
      cur.lastMealRelation = use.mealRelation ?? null;
      cur.lastDurationDays = use.durationDays ?? null;
    };
    const cur = acc.get(key);
    if (cur) {
      cur.count += 1;
      if (use.at.getTime() > cur.lastAt) {
        // The newest spelling and dose win.
        cur.lastAt = use.at.getTime();
        cur.label = label;
        if (dose) takeDose(cur);
      } else if (!cur.lastDose && dose) {
        takeDose(cur);
      }
      return;
    }
    const fresh: DrugAcc = {
      key,
      drugId,
      label,
      count: 1,
      lastDose: null,
      lastForm: null,
      lastStrength: null,
      lastTimesOfDay: [],
      lastMealRelation: null,
      lastDurationDays: null,
      pinned: false,
      lastAt: use.at.getTime(),
    };
    if (dose) takeDose(fresh);
    acc.set(key, fresh);
  };

  // Free-typed drugs group by the search's fold: «Магне B6» and «Магне®
  // В6» (Cyrillic В) are one drug he writes, not two half-counted ones.
  const textKey = (label: string) => `text:${foldCatalogText(label)}`;
  for (const s of structured) {
    const label = s.displayName.trim();
    if (label.length < 2) continue;
    bump(s.drugId ?? textKey(label), s.drugId, label, s);
  }
  for (const f of freeText) {
    const label = f.line.trim();
    if (label.length < 2) continue;
    bump(textKey(label), null, label, { dose: null, at: f.at });
  }
  return acc;
}

/** Most often first, ties to the most recent. */
function rankedHistory(acc: ReadonlyMap<string, DrugAcc>): DrugShortItem[] {
  return [...acc.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .map(toDrugItem);
}

/** A starred drug he never wrote: the route fills its label from the catalog. */
function unusedStar(id: string): DrugShortItem {
  return {
    key: id,
    drugId: id,
    label: "",
    count: 0,
    lastDose: null,
    lastForm: null,
    lastStrength: null,
    lastTimesOfDay: [],
    lastMealRelation: null,
    lastDurationDays: null,
    pinned: true,
  };
}

export function buildDrugShortlist(args: {
  /** Starred drug ids, in the doctor's order. */
  pinnedIds: string[];
  structured: StructuredDrugUse[];
  /** Free-text quick-entry lines (VisitNote.prescriptions). */
  freeText: { line: string; at: Date }[];
  limit: number;
}): DrugShortItem[] {
  const acc = accumulateDrugUses(args.structured, args.freeText);

  const pinned: DrugShortItem[] = [];
  for (const id of args.pinnedIds) {
    const used = acc.get(id);
    if (used) {
      acc.delete(id);
      pinned.push({ ...toDrugItem(used), pinned: true });
    } else {
      pinned.push(unusedStar(id));
    }
  }

  return withHistory(pinned, rankedHistory(acc), args.limit);
}

export type DrugColumns = {
  /**
   * «Частые»: what he actually writes, most often first, starred or not.
   * A star does not push history out of this column the way it does in
   * the shortlist: the two columns answer different questions.
   */
  frequent: DrugShortItem[];
  /** «Мои»: his stars in his order, with his last dose where he has one. */
  starred: DrugShortItem[];
  /**
   * His last dose and schema of every catalog drug he wrote, by drug id,
   * for a pick from the catalog column, the search or the drawer: the drug
   * comes back as he writes it even when it is not among his top ones.
   */
  usual: Map<string, DrugShortItem>;
};

/**
 * The picker's «Частые» and «Мои» columns and his usual dose per drug
 * (clinic request 03.10.2026: prescribing with the mouse only). Same
 * counting as the shortlist (drafts included, newest dose wins).
 */
export function buildDrugColumns(args: {
  pinnedIds: string[];
  structured: StructuredDrugUse[];
  freeText: { line: string; at: Date }[];
  frequentLimit: number;
  /** Upper bound on `usual`, so the payload stays small for a busy doctor. */
  usualLimit: number;
}): DrugColumns {
  const acc = accumulateDrugUses(args.structured, args.freeText);
  const pinnedIds = [...new Set(args.pinnedIds)];
  const pinnedSet = new Set(pinnedIds);
  const history = rankedHistory(acc).map((i) => ({
    ...i,
    pinned: !!i.drugId && pinnedSet.has(i.drugId),
  }));

  const starred = pinnedIds.map((id) => {
    const used = acc.get(id);
    return used ? { ...toDrugItem(used), pinned: true } : unusedStar(id);
  });

  const usual = new Map<string, DrugShortItem>();
  for (const item of history) {
    if (usual.size >= args.usualLimit) break;
    if (item.drugId) usual.set(item.drugId, item);
  }

  return {
    frequent: history.slice(0, args.frequentLimit),
    starred,
    usual,
  };
}

// ─────────────── Drugs whose brand moved to another row ───────────────

/**
 * A structured row is pinned to its drug by id, and the CDS check trusts that
 * id: it never reads the label to find the substance. When a catalog repair
 * moves a brand to the row of its real composition (audit CT-03: the register
 * import had put МИОСПАН, lidocaine + tolperisone, on the tolperisone row),
 * the rows written before keep the old pin, and so does the shortlist built
 * from them: one tap on «МИОСПАН (толперизон)» made a new row pinned to
 * tolperisone, and a lidocaine allergy stayed silent on the doctor's
 * everyday path. Those signed rows stay as they are; what the shortlist
 * offers next follows the label to the row that carries that name today.
 */

const pairKey = (drugId: string, label: string) => `${drugId}\u0000${label}`;

/**
 * Whether a use's label does not name the drug it is pinned to by any name
 * `current` knows for it (its name, INN, brands, the clinic's own names).
 * Only a candidate: `repinDrugUses` moves it only when the catalog places
 * the label on another row. A use whose drug is not in `current` is left
 * alone (the route shows it without catalog data anyway).
 */
function makeStaleCheck<D extends TextMatchDrug>(current: ReadonlyMap<string, D>) {
  const own = new Map<string, DrugTextIndex<D>>();
  const memo = new Map<string, boolean>();
  return (u: StructuredDrugUse): boolean => {
    if (!u.drugId) return false;
    const drug = current.get(u.drugId);
    if (!drug) return false;
    const key = pairKey(u.drugId, u.displayName);
    const known = memo.get(key);
    if (known !== undefined) return known;
    let index = own.get(drug.id);
    if (!index) {
      index = buildDrugTextIndex([drug]);
      own.set(drug.id, index);
    }
    const stale = matchDrugLine(index, u.displayName) === null;
    memo.set(key, stale);
    return stale;
  };
}

/** Cheap test the route runs before loading the whole catalog. */
export function hasStaleDrugUse<D extends TextMatchDrug>(
  uses: readonly StructuredDrugUse[],
  current: ReadonlyMap<string, D>,
): boolean {
  return uses.some(makeStaleCheck(current));
}

/**
 * Re-pin each stale use (see `makeStaleCheck`) to the catalog row its label
 * names now, labelled the way a search pick of that name is today
 * («МИОСПАН (лидокаин + толперизон)»), so the shortlist groups it with the
 * new row and a tap on it pins the right drug. A label the catalog cannot
 * place keeps its pin. When the row it lands on is hidden from the clinic
 * the route shows the item without catalog data, and the constructor adds it
 * as a text line that the CDS check resolves by name, again to that row.
 */
export function repinDrugUses<
  D extends TextMatchDrug,
  U extends StructuredDrugUse = StructuredDrugUse,
>(args: {
  /** Extra fields a caller carries on a use (its note) pass through. */
  uses: readonly U[];
  current: ReadonlyMap<string, D>;
  /** The clinic's catalog with its own names as brands. */
  catalog: DrugTextIndex<D>;
}): U[] {
  const isStale = makeStaleCheck(args.current);
  const moved = new Map<string, { drugId: string; displayName: string } | null>();
  return args.uses.map((u) => {
    if (!u.drugId || !isStale(u)) return u;
    const key = pairKey(u.drugId, u.displayName);
    let to = moved.get(key);
    if (to === undefined) {
      const hit = matchDrugLine(args.catalog, u.displayName);
      to =
        hit && hit.drug.id !== u.drugId
          ? {
              drugId: hit.drug.id,
              displayName: prescriptionLabel(hit.drug, hit.label),
            }
          : null;
      moved.set(key, to);
    }
    return to ? { ...u, ...to } : u;
  });
}

function toDrugItem(a: DrugShortItem): DrugShortItem {
  return {
    key: a.key,
    drugId: a.drugId,
    label: a.label,
    count: a.count,
    lastDose: a.lastDose,
    lastForm: a.lastForm,
    lastStrength: a.lastStrength,
    lastTimesOfDay: [...a.lastTimesOfDay],
    lastMealRelation: a.lastMealRelation,
    lastDurationDays: a.lastDurationDays,
    pinned: a.pinned,
  };
}
