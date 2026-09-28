/**
 * Pure edits of the structured prescription list (audit VW-01).
 *
 * The list is saved replace-all: every action sends the WHOLE array. So an
 * action must be composed on top of the rows as the doctor last left them,
 * never on the snapshot the component rendered with. «Ввёл дозу, кликнул
 * „Утро“» fires two actions before the first response is back; composed
 * from the render snapshot, the second one carried the old dose and the
 * server applied it last. Callers pass the live rows (the query cache,
 * which `usePatchVisitNote` updates the moment an edit is made) and get
 * back the array to send.
 */
import { prescriptionLabel } from "@/lib/catalogs/brand-match";
import {
  defaultDose,
  formOfStrength,
  isConcentrationOrPack,
  normalizeForms,
  normalizeStrength,
  pickDefaultForm,
  type DrugFormOption,
} from "@/lib/catalogs/drug-forms";

import type { DrugSearchHit } from "./use-drug-search";
import type { DrugShortItem } from "./use-shortlists";
import type {
  VisitPrescriptionDraft,
  VisitPrescriptionRow,
  VisitPrescriptionTimeOfDay,
} from "./use-visit-note";

/** An edit of one row: fixed values, or computed from the row's live state. */
export type RowEdit =
  | Partial<VisitPrescriptionDraft>
  | ((current: VisitPrescriptionDraft) => Partial<VisitPrescriptionDraft>);

const TIME_ORDER: VisitPrescriptionTimeOfDay[] = [
  "MORNING",
  "NOON",
  "EVENING",
  "NIGHT",
];

/**
 * Build a structured row draft from a catalog drug (search hit, drawer pick
 * or shortlist item). `term` is what the doctor typed: when it names a brand
 * the row is labelled «Мидокалм (толперизон)» rather than the bare substance
 * — the clinic reported typing a brand and getting back a word the patient
 * will never see on the box.
 *
 * The how-to-take text starts EMPTY (audit G4-06). It used to be copied from
 * `defaultDosing.adult`, which is reference text for the doctor («Старт
 * 100–200 мг, титровать до 400–1200 мг/сут», «Депрессия: …; нейропатическая
 * боль: …»): it reached the patient's handout and print under the doctor's
 * signature, with dose ranges to climb on his own and diagnoses he does not
 * have, while the collapsed row never showed it. What the patient reads is
 * now only what the doctor writes.
 *
 * The form is the drug's first oral form and the dose is filled only when
 * that form's strength is one tablet's amount (audit G4-07, see
 * drug-forms.ts). For insulin, lactulose or drops it stays EMPTY: the
 * constructor then asks for the dose before the row is added, instead of
 * printing a concentration («100 ЕД/мл») where the dose goes.
 */
export function draftFromDrug(
  d: Pick<DrugSearchHit, "id" | "nameRu"> & {
    forms?: unknown;
    brands?: { name: string }[];
  },
  term = "",
): VisitPrescriptionDraft {
  const { form, strength } = pickDefaultForm(normalizeForms(d.forms));
  return {
    drugId: d.id,
    displayName: prescriptionLabel(
      { nameRu: d.nameRu, brands: d.brands ?? [] },
      term,
    ),
    form,
    strength,
    dose: defaultDose(form, strength),
    timesOfDay: [],
    mealRelation: "NO_MATTER",
    durationDays: null,
    instructionRu: null,
    instructionUz: null,
    remindPatient: true,
  };
}

/** A row draft with the forms its drug comes in (empty for a manual row). */
export type DraftPick = { draft: VisitPrescriptionDraft; forms: DrugFormOption[] };

/**
 * A shortlist pick as a row draft. His own items come back as he wrote them
 * last time: wording, form, strength and dose (audit G4-07). The clinic's
 * core-list items are labelled with the clinic's name («Анаприлин
 * (пропранолол)») and its usual strength, in the form that strength belongs
 * to; their dose is filled only when that strength is one tablet's amount.
 */
export function draftFromShortItem(
  item: DrugShortItem,
  kind: "mine" | "clinic",
): DraftPick {
  if (item.drug) {
    const forms = normalizeForms(item.drug.forms);
    const base = draftFromDrug(item.drug, item.label);
    const displayName =
      kind === "mine" && item.label ? item.label : base.displayName;
    if (kind === "mine" && (item.lastDose || item.lastForm)) {
      const lastForm = item.lastForm ?? null;
      const form = lastForm ?? base.form;
      const strength = lastForm ? (item.lastStrength ?? null) : base.strength;
      // The old constructor copied the strength into the dose untouched
      // («500 мг/4 мл»): that concentration was never his dose, so it is not
      // repeated. A dose he wrote («1000 мг») is, and so is a dose equal to
      // a strength that is one ampoule or one tablet: «2 мл» of Мильгамма or
      // «1 таб.» of Панангин is exactly what he types into the dose prompt,
      // and reading it as untouched asked him for it on every pick.
      const last = item.lastDose?.trim() ?? "";
      const untouchedDefault =
        !!last &&
        last === (item.lastStrength ?? "").trim() &&
        isConcentrationOrPack(last);
      return {
        forms,
        draft: {
          ...base,
          displayName,
          form,
          strength,
          dose: last && !untouchedDefault ? last : defaultDose(form, strength),
        },
      };
    }
    const usual = item.strengths[0] ? normalizeStrength(item.strengths[0]) : null;
    if (usual) {
      const form = formOfStrength(forms, usual) ?? base.form;
      return {
        forms,
        draft: {
          ...base,
          displayName,
          form,
          strength: usual,
          dose: defaultDose(form, usual),
        },
      };
    }
    return { forms, draft: { ...base, displayName } };
  }
  // A free-typed line from his history: «Магне B6 — по 2 таб 2 раза…».
  // The part after the dash is the dose as he wrote it.
  const { name, dose } = splitFreeLine(item.label);
  return {
    forms: [],
    draft: {
      drugId: null,
      displayName: name,
      form: null,
      strength: null,
      dose: dose ?? item.lastDose ?? "",
      timesOfDay: [],
      mealRelation: "NO_MATTER",
      durationDays: null,
      instructionRu: null,
      instructionUz: null,
      remindPatient: true,
    },
  };
}

/** «Магне B6 — по 2 таб…» → name + dose; a line without a dash has none. */
export function splitFreeLine(line: string): { name: string; dose: string | null } {
  const [name, ...rest] = line.split(" — ");
  return {
    name: (name ?? line).trim(),
    dose: rest.join(" — ").trim() || null,
  };
}

/** Stored rows → PATCH drafts (the server assigns ids and sortOrder). */
export function toPrescriptionDrafts(
  rows: ReadonlyArray<VisitPrescriptionRow | VisitPrescriptionDraft>,
): VisitPrescriptionDraft[] {
  return rows.map((row) => {
    const {
      id: _id,
      sortOrder: _sortOrder,
      ...rest
    } = row as VisitPrescriptionRow;
    return rest;
  });
}

/** Apply `edit` to row `index`; null when there is no such row. */
export function withRowEdited(
  drafts: VisitPrescriptionDraft[],
  index: number,
  edit: RowEdit,
): VisitPrescriptionDraft[] | null {
  const current = drafts[index];
  if (!current) return null;
  const patch = typeof edit === "function" ? edit(current) : edit;
  const next = drafts.slice();
  next[index] = { ...current, ...patch };
  return next;
}

export function withRowRemoved(
  drafts: VisitPrescriptionDraft[],
  index: number,
): VisitPrescriptionDraft[] | null {
  if (!drafts[index]) return null;
  const next = drafts.slice();
  next.splice(index, 1);
  return next;
}

/** Toggle a time of day, keeping the canonical morning → night order. */
export function toggleTimeOfDay(
  times: VisitPrescriptionTimeOfDay[],
  time: VisitPrescriptionTimeOfDay,
): VisitPrescriptionTimeOfDay[] {
  return times.includes(time)
    ? times.filter((x) => x !== time)
    : TIME_ORDER.filter((x) => times.includes(x) || x === time);
}
