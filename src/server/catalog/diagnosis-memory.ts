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
 * Pure: the route feeds it rows, the tests feed it arrays.
 */
import { foldCatalogText } from "@/lib/catalogs/search-fold";

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
  ]);
}

type RxAcc = {
  key: string;
  drugId: string | null;
  /** His newest wording. */
  label: string;
  count: number;
  /** Index of the newest visit it is on (0 = the most recent visit). */
  newest: number;
  /** Ways he wrote it: how often, how recently, and the values. */
  schedules: Map<string, { count: number; newest: number; schedule: Schedule }>;
};

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
    const take = (key: string, drugId: string | null, label: string, schedule: Schedule) => {
      if (onThisVisit.has(key)) return;
      onThisVisit.add(key);
      let acc = rx.get(key);
      if (!acc) {
        // Newest visits come first: the first wording seen is his current one.
        acc = { key, drugId, label, count: 0, newest: index, schedules: new Map() };
        rx.set(key, acc);
      }
      acc.count += 1;
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
      take(textKey(label), null, label, { dose: null });
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

  const min = memoryThreshold(notes.length);
  const byUse = <T extends { count: number; newest: number }>(a: T, b: T) =>
    b.count - a.count || a.newest - b.newest;

  const prescriptions = [...rx.values()]
    .filter((r) => r.count >= min)
    .sort(byUse)
    .slice(0, args.prescriptionLimit ?? MEMORY_PRESCRIPTION_LIMIT)
    .map((r): DrugShortItem => {
      const usual = [...r.schedules.values()].sort(byUse)[0]!.schedule;
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
