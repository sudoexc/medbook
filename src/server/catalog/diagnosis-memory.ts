/**
 * «Обычно при <диагноз>» — what this doctor prescribes and recommends with a
 * diagnosis, learned from his own past visits with it.
 *
 * The clinic's request (03.10.2026): the system remembers which
 * prescriptions (drug, dose and schema) and which recommendations go with a
 * diagnosis, so once the doctor picks the diagnosis they are one click away
 * instead of being found and set again on every visit. Nobody fills a
 * template for it: his visits are the template.
 *
 * Which visits: his notes whose MAIN diagnosis is this one (by ICD code, or
 * by the words of a diagnosis written without a code), drafts included,
 * since in this clinic most visits are never signed. Main only, on purpose:
 * on a lumbago visit with hypertension as the second diagnosis, the drugs
 * are for the lumbago, and counting them for hypertension would offer
 * painkillers to the next hypertensive patient. A visit that holds neither a
 * prescription nor a recommendation (a draft opened and left) says nothing
 * about his practice and is not counted at all.
 *
 * What counts as usual: a drug or a recommendation that comes back. With one
 * or two such visits everything he did is offered (that is all there is to
 * go on); from three on, only what appears on at least two of them and on at
 * least 15% of them, so a one-off for a particular patient does not become
 * the rule. Each drug comes with the dose and schema he wrote most often for
 * it with this diagnosis, ties going to the most recent: his usual, not
 * whatever he wrote last for an unusual patient.
 *
 * One drug, one entry (review of 03.10.2026): on some visits he picked
 * Мексидол from the catalog, on others a preset or a protocol put it on as
 * the line «Мексидол 5,0 в/м №10». Counted apart they made two chips, and
 * «Добавить всё» put the drug on the sheet twice. A line that names a drug
 * he also wrote as a row (line-names-drug.ts), and a hand-typed row that
 * names a catalog drug, count for that drug: their visits join its visits.
 * A line says nothing about a dose, so the dose and schema stay the rows'.
 *
 * Pure: the route feeds it rows, the tests feed it arrays.
 */
import { foldCatalogText } from "@/lib/catalogs/search-fold";
import {
  drugNameForms,
  lineWords,
  wordsNameDrug,
} from "@/lib/catalogs/line-names-drug";

import type { DrugShortItem, StructuredDrugUse } from "./shortlist";

/** One past visit of his with the diagnosis. */
export type MemoryNote = {
  id: string;
  at: Date;
  /** Its structured prescription rows, in the order he wrote them. */
  structured: readonly Omit<StructuredDrugUse, "at">[];
  /** Its free-text prescription lines (older notes, presets, protocols). */
  freeText: readonly string[];
  /** Its recommendations («Рекомендации»). */
  advice: readonly string[];
};

export type MemoryAdvice = {
  /** His newest wording of it. */
  line: string;
  /** On how many of the visits. */
  count: number;
};

export type DiagnosisMemory = {
  /** His visits with this diagnosis that held a prescription or advice. */
  visits: number;
  /**
   * The usual prescriptions, most often first. `count` is the number of
   * visits; the `last*` fields carry his usual dose and schema for it (the
   * shape every one-click pick reads, see shortlist.ts).
   */
  prescriptions: DrugShortItem[];
  advice: MemoryAdvice[];
};

export const MEMORY_PRESCRIPTION_LIMIT = 12;
export const MEMORY_ADVICE_LIMIT = 10;

/** On how many visits something must appear to count as his usual. */
export function memoryThreshold(visits: number): number {
  return visits < 3 ? 1 : Math.max(2, Math.ceil(visits * 0.15));
}

/** Free-typed drugs group by the search's fold, as in the shortlist. */
const textKey = (label: string) => `text:${foldCatalogText(label)}`;

/** Recommendations group by their words, case, spacing and ё aside. */
function adviceKey(line: string): string {
  return line.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

type Schedule = Omit<StructuredDrugUse, "drugId" | "displayName" | "at">;

/** What one way of writing a drug is: its dose, form and schema. */
function scheduleKey(s: Schedule): string {
  return JSON.stringify([
    s.dose?.trim() ?? "",
    s.form ?? null,
    s.strength ?? null,
    [...(s.timesOfDay ?? [])].sort(),
    s.mealRelation ?? null,
    s.durationDays ?? null,
    // «Постоянно» is a way of writing it of its own, not «days not set».
    !!s.ongoing,
  ]);
}

type RxAcc = {
  key: string;
  drugId: string | null;
  /** His newest wording. */
  label: string;
  /** The visits it is on, by index (0 = the most recent visit). */
  visits: Set<number>;
  /** Index of the newest visit it is on. */
  newest: number;
  /** The wordings of its rows; empty when he only ever had it as a line. */
  rowNames: Set<string>;
  /** Ways he wrote it as a row: how often, how recently, and the values. */
  schedules: Map<string, { count: number; newest: number; schedule: Schedule }>;
};

/**
 * Fold what names a drug into that drug's entry: a hand-typed row or a text
 * line («Мексидол 5,0 в/м №10») joins the catalog drug it names, and a line
 * with no catalog drug to join joins a hand-typed row it names. Visits join
 * as sets, so a visit that has both counts once. A row's ways of writing the
 * dose come along; a line has none to give.
 */
function joinNamedDrugs(rx: Map<string, RxAcc>): void {
  const targets = [...rx.values()]
    .filter((e) => e.rowNames.size > 0)
    // A catalog drug first: that is the row a chip should make.
    .sort((a, b) => Number(!!b.drugId) - Number(!!a.drugId))
    .map((entry) => ({ entry, forms: [...entry.rowNames].flatMap(drugNameForms) }));
  // Hand-typed rows before lines: a line that names a hand-typed row of a
  // catalog drug then finds the catalog drug that row has joined.
  const sources = [...rx.values()]
    .filter((e) => !e.drugId)
    .sort((a, b) => b.rowNames.size - a.rowNames.size);
  for (const source of sources) {
    const isRow = source.rowNames.size > 0;
    const words = lineWords(source.label);
    const target = targets.find(
      ({ entry, forms }) =>
        entry !== source &&
        rx.has(entry.key) &&
        // A hand-typed row joins a catalog drug only: two names he typed
        // himself are two drugs to him.
        (!isRow || !!entry.drugId) &&
        wordsNameDrug(words, forms),
    );
    if (!target) continue;
    const into = target.entry;
    for (const v of source.visits) into.visits.add(v);
    into.newest = Math.min(into.newest, source.newest);
    for (const name of source.rowNames) {
      into.rowNames.add(name);
      target.forms.push(...drugNameForms(name));
    }
    for (const [sk, way] of source.schedules) {
      const known = into.schedules.get(sk);
      if (known) {
        known.count += way.count;
        known.newest = Math.min(known.newest, way.newest);
      } else {
        into.schedules.set(sk, { ...way });
      }
    }
    rx.delete(source.key);
  }
}

type AdviceAcc = { line: string; count: number; newest: number };

export function buildDiagnosisMemory(args: {
  notes: readonly MemoryNote[];
  prescriptionLimit?: number;
  adviceLimit?: number;
}): DiagnosisMemory {
  const notes = args.notes
    .filter(
      (n) =>
        n.structured.some((s) => s.displayName.trim().length >= 2) ||
        n.freeText.some((l) => l.trim().length >= 2) ||
        n.advice.some((a) => a.trim().length > 0),
    )
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const rx = new Map<string, RxAcc>();
  const advice = new Map<string, AdviceAcc>();

  notes.forEach((note, index) => {
    // One use per visit: a drug written on two rows of one visit (two
    // forms, two strengths) is still one visit he gave it on.
    const onThisVisit = new Set<string>();
    /** `schedule` is null for a text line: it names a drug, not a dose. */
    const take = (
      key: string,
      drugId: string | null,
      label: string,
      schedule: Schedule | null,
    ) => {
      if (onThisVisit.has(key)) return;
      onThisVisit.add(key);
      let acc = rx.get(key);
      if (!acc) {
        // Newest visits come first: the first wording seen is his current one.
        acc = {
          key,
          drugId,
          label,
          visits: new Set(),
          newest: index,
          rowNames: new Set(),
          schedules: new Map(),
        };
        rx.set(key, acc);
      }
      acc.visits.add(index);
      if (!schedule) return;
      acc.rowNames.add(label);
      const sk = scheduleKey(schedule);
      const known = acc.schedules.get(sk);
      if (known) known.count += 1;
      else acc.schedules.set(sk, { count: 1, newest: index, schedule });
    };
    for (const s of note.structured) {
      const label = s.displayName.trim();
      if (label.length < 2) continue;
      take(s.drugId ?? textKey(label), s.drugId, label, s);
    }
    for (const raw of note.freeText) {
      const label = raw.trim();
      if (label.length < 2) continue;
      take(textKey(label), null, label, null);
    }

    const adviceOnVisit = new Set<string>();
    for (const raw of note.advice) {
      const line = raw.trim();
      const key = adviceKey(line);
      if (!key || adviceOnVisit.has(key)) continue;
      adviceOnVisit.add(key);
      const acc = advice.get(key);
      if (acc) acc.count += 1;
      else advice.set(key, { line, count: 1, newest: index });
    }
  });

  joinNamedDrugs(rx);

  const min = memoryThreshold(notes.length);
  const byUse = <T extends { count: number; newest: number }>(a: T, b: T) =>
    b.count - a.count || a.newest - b.newest;

  const prescriptions = [...rx.values()]
    .map((r) => ({ ...r, count: r.visits.size }))
    .filter((r) => r.count >= min)
    .sort(byUse)
    .slice(0, args.prescriptionLimit ?? MEMORY_PRESCRIPTION_LIMIT)
    .map((r): DrugShortItem => {
      // Only ever a line: no dose of his to offer.
      const usual: Schedule = [...r.schedules.values()].sort(byUse)[0]?.schedule ?? {
        dose: null,
      };
      return {
        key: r.key,
        drugId: r.drugId,
        label: r.label,
        count: r.count,
        lastDose: usual.dose?.trim() || null,
        lastForm: usual.form ?? null,
        lastStrength: usual.strength ?? null,
        lastTimesOfDay: [...(usual.timesOfDay ?? [])],
        lastMealRelation: usual.mealRelation ?? null,
        lastDurationDays: usual.durationDays ?? null,
        ...(usual.ongoing ? { lastOngoing: true as const } : {}),
        pinned: false,
      };
    });

  return {
    visits: notes.length,
    prescriptions,
    advice: [...advice.values()]
      .filter((a) => a.count >= min)
      .sort(byUse)
      .slice(0, args.adviceLimit ?? MEMORY_ADVICE_LIMIT)
      .map((a) => ({ line: a.line, count: a.count })),
  };
}
