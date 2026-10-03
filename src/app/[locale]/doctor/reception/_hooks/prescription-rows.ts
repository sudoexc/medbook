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
import {
  isEmptyDrugSchema,
  isStrengthCopiedAsDose,
  type DrugArsenalSchema,
} from "@/lib/arsenal";
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
import type { DrugShortItem, DrugUsual } from "./use-shortlists";
import type {
  VisitPrescriptionDraft,
  VisitPrescriptionMealRelation,
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

const MEAL_RELATIONS: ReadonlySet<string> = new Set<VisitPrescriptionMealRelation>([
  "BEFORE_MEAL",
  "WITH_MEAL",
  "AFTER_MEAL",
  "EMPTY_STOMACH",
  "NO_MATTER",
]);

/**
 * His last schedule as row fields, in canonical order, unknown values
 * dropped: the history is read back from the server and a value a later
 * build no longer knows must not reach the replace-all save.
 */
function scheduleOf(
  item: Pick<DrugShortItem, "lastTimesOfDay" | "lastMealRelation" | "lastDurationDays">,
): Pick<VisitPrescriptionDraft, "timesOfDay" | "mealRelation" | "durationDays"> {
  const times = item.lastTimesOfDay ?? [];
  const meal = item.lastMealRelation;
  const days = item.lastDurationDays;
  return {
    timesOfDay: TIME_ORDER.filter((t) => times.includes(t)),
    mealRelation:
      meal && MEAL_RELATIONS.has(meal)
        ? (meal as VisitPrescriptionMealRelation)
        : "NO_MATTER",
    durationDays:
      typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 365
        ? days
        : null,
  };
}

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
 * What to do with a pick that needs its dose written first, given the pick
 * already waiting in the dose prompt (if any):
 *
 *   "open" — nothing waits on this note: the prompt opens for it;
 *   "same" — it is the drug already waiting (a second click on it): show
 *            the prompt again, nothing changes;
 *   "busy" — another drug waits: keep it and say so. Replacing it silently
 *            dropped the first drug from the visit while the doctor
 *            believed he had prescribed both.
 *
 * A pick left behind on another patient's note does not count.
 */
export function admitPendingPick(
  waiting: { draft: Pick<VisitPrescriptionDraft, "drugId" | "displayName">; noteId: string } | null,
  incoming: Pick<VisitPrescriptionDraft, "drugId" | "displayName">,
  noteId: string,
): "open" | "same" | "busy" {
  if (!waiting || waiting.noteId !== noteId) return "open";
  const a = waiting.draft;
  const same = a.drugId || incoming.drugId
    ? a.drugId === incoming.drugId
    : a.displayName.trim() === incoming.displayName.trim();
  return same ? "same" : "busy";
}

/**
 * A pick still waiting in the dose prompt when the doctor signs the visit
 * or opens its preview. It is the constructor's local state, outside the
 * PATCH queue the sign flow waits for, so without this refusal the visit
 * was signed (and its handout and reminders sent) without that drug.
 * Thrown from the constructor's entry in the reception's flush registry.
 */
export class PendingDosePickError extends Error {
  readonly displayName: string;
  constructor(displayName: string) {
    super(`a prescription waits for its dose: ${displayName}`);
    this.name = "PendingDosePickError";
    this.displayName = displayName;
  }
}

export function isPendingDosePick(e: unknown): e is PendingDosePickError {
  return e instanceof PendingDosePickError;
}

/**
 * A «Мои» item with the schema he set on «Мой арсенал», as a row draft:
 * his wording, then each field of the schema over the catalog's default
 * (the form and strength he chose, his dose, times, meal, days and the
 * instruction he wants on the handout). A field he left empty takes the
 * catalog's default, never an older visit's value: the schema is what he
 * decided, and mixing a remembered dose into it would prescribe something
 * he did not write.
 *
 * WHY its own path and not `last*`: the schema can hold an instruction and
 * a schedule without a dose, which the «last time» path cannot express.
 */
export function draftFromArsenalSchema(
  item: DrugShortItem & { drug: NonNullable<DrugShortItem["drug"]> },
  schema: DrugArsenalSchema,
): DraftPick {
  const forms = normalizeForms(item.drug.forms);
  const base = draftFromDrug(item.drug, item.label);
  const form = schema.form ?? base.form;
  // A strength names a form: one he chose goes with it; with no form of
  // his, a strength he wrote is placed on the form it belongs to.
  const strength = schema.form
    ? (schema.strength ??
      forms.find((f) => f.form === schema.form)?.strengths[0] ??
      null)
    : schema.strength
      ? normalizeStrength(schema.strength)
      : base.strength;
  const formForStrength =
    !schema.form && schema.strength
      ? (formOfStrength(forms, normalizeStrength(schema.strength)) ?? form)
      : form;
  const sched = scheduleOf({
    lastTimesOfDay: schema.timesOfDay,
    lastMealRelation: schema.mealRelation,
    lastDurationDays: schema.durationDays,
  });
  // A schema dose that is one of the drug's strengths copied over («500
  // мг/4 мл» from the old constructor) is no dose: the row goes through the
  // catalog's default or the dose prompt, as the «Частые» path does, never
  // straight onto the handout as «Доза» (review of 03.10.2026).
  const ownDose = schema.dose?.trim() ?? "";
  const copied = isStrengthCopiedAsDose(ownDose, [
    schema.strength,
    strength,
    ...forms.flatMap((f) => f.strengths),
  ]);
  return {
    forms,
    draft: {
      ...base,
      displayName: item.label || base.displayName,
      form: formForStrength,
      strength,
      dose: ownDose && !copied ? ownDose : defaultDose(formForStrength, strength),
      ...sched,
      instructionRu: schema.instructionRu,
      instructionUz: schema.instructionUz,
    },
  };
}

/**
 * A shortlist pick as a row draft. His own items come back as he wrote them
 * last time: wording, form, strength and dose (audit G4-07). The clinic's
 * core-list items are labelled with the clinic's name («Анаприлин
 * (пропранолол)») and its usual strength, in the form that strength belongs
 * to; their dose is filled only when that strength is one tablet's amount.
 *
 * An item of «Мои» with an arsenal schema comes back as the schema says
 * (`draftFromArsenalSchema`), whatever `kind`: his set schema outranks
 * what he wrote last time. Only «Мои» items carry one; «Частые» keep the
 * learned «last time» path.
 */
export function draftFromShortItem(
  item: DrugShortItem,
  kind: "mine" | "clinic",
): DraftPick {
  if (item.drug && item.arsenalSchema && !isEmptyDrugSchema(item.arsenalSchema)) {
    return draftFromArsenalSchema({ ...item, drug: item.drug }, item.arsenalSchema);
  }
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
          // The schema he wrote with that dose: one click brings back the
          // whole prescription (clinic request 03.10.2026).
          ...scheduleOf(item),
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
  // The part after the dash is the dose as he wrote it. A manual row of
  // his comes back with its dose and schema, like a catalog one.
  const { name, dose } = splitFreeLine(item.label);
  return {
    forms: [],
    draft: {
      drugId: null,
      displayName: name,
      form: null,
      strength: null,
      dose: dose ?? item.lastDose ?? "",
      ...scheduleOf(item),
      instructionRu: null,
      instructionUz: null,
      remindPatient: true,
    },
  };
}

/**
 * How a picker item is turned into a row: his own wording, or the clinic's.
 * An arsenal pin is his even before he ever wrote it: its label is the one
 * he pinned, not the clinic's.
 */
export function shortItemKind(
  item: Pick<DrugShortItem, "count"> & { arsenalSchema?: DrugArsenalSchema | null },
): "mine" | "clinic" {
  return item.count > 0 || !isEmptyDrugSchema(item.arsenalSchema) ? "mine" : "clinic";
}

/**
 * A catalog drug as a picker item, carrying his history with it when he has
 * one (the «Каталог» column, «При <код>», search hits, the drawer): a pick
 * then comes back with his usual dose and schema like a «Частые» one.
 */
export function shortItemFromDrug(
  drug: DrugSearchHit,
  usual: DrugUsual | null | undefined,
  opts: { label?: string; strengths?: string[]; pinned?: boolean } = {},
): DrugShortItem {
  return {
    key: drug.id,
    drugId: drug.id,
    label: usual?.label || opts.label || drug.nameRu,
    count: usual?.count ?? 0,
    lastDose: usual?.lastDose ?? null,
    lastForm: usual?.lastForm ?? null,
    lastStrength: usual?.lastStrength ?? null,
    lastTimesOfDay: usual?.lastTimesOfDay ?? [],
    lastMealRelation: usual?.lastMealRelation ?? null,
    lastDurationDays: usual?.lastDurationDays ?? null,
    pinned: opts.pinned ?? false,
    strengths: opts.strengths ?? [],
    drug,
  };
}

/**
 * A drug picked from the catalog (column, search, drawer) as a row draft.
 * With his history: his dose and schema; the wording is his too unless he
 * searched by a name (`term`), which then leads as in any search pick.
 * Without it: the catalog's default, exactly as before.
 */
export function draftFromCatalogPick(
  drug: Parameters<typeof draftFromDrug>[0],
  usual: DrugUsual | null | undefined,
  term = "",
): DraftPick {
  const forms = normalizeForms(drug.forms);
  const base = draftFromDrug(drug, term);
  if (!usual || usual.count <= 0 || (!usual.lastDose && !usual.lastForm)) {
    return { draft: base, forms };
  }
  // Only what `draftFromShortItem` reads: the id, the names and the forms.
  const hit: DrugSearchHit = {
    id: drug.id,
    nameRu: drug.nameRu,
    inn: "",
    nameUz: null,
    atcCode: null,
    category: "",
    defaultDosing: null,
    rxOnly: false,
    forms,
    brands: (drug.brands ?? []).map((b, i) => ({
      id: `brand-${i}`,
      name: b.name,
      manufacturer: null,
    })),
  };
  const { draft } = draftFromShortItem(shortItemFromDrug(hit, usual), "mine");
  return {
    forms,
    draft: term.trim() ? { ...draft, displayName: base.displayName } : draft,
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
