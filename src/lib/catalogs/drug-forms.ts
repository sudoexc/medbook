/**
 * Audit G4-07 — the form, strength and default dose of a picked drug.
 *
 * A catalog pick took the drug's first form and that form's first
 * «strength» as the dose. The first form is often an injection or a cream
 * (citicoline always went out as INJ_IV «500 мг/4 мл», acyclovir as a
 * cream), and a strength is often a concentration or a pack: the dose of a
 * new row read «100 ЕД/мл» for insulin, «667 мг/мл» for lactulose, «500
 * МЕ/капля» for vitamin D3, «1 флакон», «5%». That is what the patient's
 * handout and the pharmacy read as «how much to take»; for insulin «100 ЕД»
 * reads like a dose.
 *
 * Now:
 *   - the default form is the first ORAL form in the catalog's order (the
 *     catalog lists the usual form first), else the first form; the doctor
 *     picks any other form of the drug on the row;
 *   - only a solid unit form (tablet, capsule, suppository, patch) with one
 *     amount per unit («500 мг», «2000 МЕ») gives a default dose. For
 *     liquids, injections and topical forms, and for any strength that is a
 *     concentration or a pack, the dose starts empty and must be written
 *     before the row is added;
 *   - strengths are shown normalised and without duplicates: the state
 *     register lists «200 мг» next to «200мг» and «24.0 мг/мл».
 *
 * Pure: shared by the constructor, the shortlist and the tests.
 */

export type DrugFormOption = { form: string; strengths: string[] };

/** Taken by mouth: the default a pick starts from. */
const ORAL_FORMS = new Set(["TAB", "CAP", "SYRUP", "DROPS_ORAL", "POWDER"]);

/** One unit is one dose: a strength per unit can stand for the dose. */
const UNIT_FORMS = new Set(["TAB", "CAP", "SUPP_RECT", "SUPP_VAG", "PATCH"]);

/** One amount of substance per unit: «500 мг», «0,5 г», «2000 МЕ». */
const UNIT_AMOUNT = /^\d+(?:,\d+)?\s?(?:мг|г|мкг|ме|ед|mg|g|mcg|µg|iu|ui)\.?$/iu;

export function isOralForm(form: string | null | undefined): boolean {
  return !!form && ORAL_FORMS.has(form);
}

export function isUnitForm(form: string | null | undefined): boolean {
  return !!form && UNIT_FORMS.has(form);
}

/**
 * «200мг» → «200 мг», «24.0 мг/мл» → «24 мг/мл», «2.5 мг» → «2,5 мг»: the
 * register's spellings in the curated catalog's style.
 */
export function normalizeStrength(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\d)\.(\d)/g, "$1,$2")
    .replace(/(\d),0+(?!\d)/g, "$1")
    .replace(/(\d)(?=[A-Za-zА-Яа-яЁёµ])/gu, "$1 ");
}

function strengthKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/** Normalised, without empties and without repeats, in catalog order. */
export function normalizeStrengths(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const s = normalizeStrength(item);
    const key = strengthKey(s);
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * `Drug.forms` as stored (JSON: `{form, strengths}`, the static catalog's
 * `{form, doses}` too), cleaned: one entry per form code, strengths
 * normalised.
 */
export function normalizeForms(raw: unknown): DrugFormOption[] {
  if (!Array.isArray(raw)) return [];
  const byForm = new Map<string, string[]>();
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const o = f as { form?: unknown; strengths?: unknown; doses?: unknown };
    if (typeof o.form !== "string" || !o.form) continue;
    const strengths = normalizeStrengths(o.strengths ?? o.doses);
    byForm.set(o.form, [...(byForm.get(o.form) ?? []), ...strengths]);
  }
  return [...byForm.entries()].map(([form, strengths]) => ({
    form,
    strengths: normalizeStrengths(strengths),
  }));
}

/** Can this strength stand for the dose of one unit? */
export function isUnitDose(strength: string | null | undefined): boolean {
  return !!strength && UNIT_AMOUNT.test(normalizeStrength(strength));
}

/**
 * A concentration or a whole pack: «500 мг/4 мл», «100 ЕД/мл», «20 мг/доза»,
 * «5%», «1 флакон», «1 туба 40 г», «для небулайзера». Never a dose to take.
 * A plain volume or count («2 мл», «10 мл», «1 таб.») is: an ampoule of
 * Мильгамма is given whole.
 */
const NOT_A_DOSE = /[/%]|флакон|туб[аы](?![а-я])|небулайзер/iu;

export function isConcentrationOrPack(strength: string | null | undefined): boolean {
  return !!strength && NOT_A_DOSE.test(strength);
}

/**
 * The dose a new row starts with: the unit strength of a solid unit form,
 * else empty (the doctor writes it: «10 ЕД», «15 мл», «2 капли»).
 */
export function defaultDose(
  form: string | null | undefined,
  strength: string | null | undefined,
): string {
  return isUnitForm(form) && strength && isUnitDose(strength)
    ? normalizeStrength(strength)
    : "";
}

/** The form and strength a pick starts with. */
export function pickDefaultForm(forms: readonly DrugFormOption[]): {
  form: string | null;
  strength: string | null;
} {
  const chosen = forms.find((f) => isOralForm(f.form)) ?? forms[0] ?? null;
  return {
    form: chosen?.form ?? null,
    strength: chosen?.strengths[0] ?? null,
  };
}

type FormFields = { form: string | null; strength: string | null; dose: string };

/**
 * The row after the doctor picks another form. The dose follows only while
 * it is still the default of the old form: a dose he wrote stays his. It
 * may come back empty, and then has to be written.
 */
export function withForm(
  row: FormFields,
  forms: readonly DrugFormOption[],
  form: string,
): FormFields {
  const strength = forms.find((f) => f.form === form)?.strengths[0] ?? null;
  const followsDefault =
    !row.dose.trim() || row.dose.trim() === defaultDose(row.form, row.strength);
  return {
    form,
    strength,
    dose: followsDefault ? defaultDose(form, strength) : row.dose,
  };
}

/** The row after the doctor picks another strength of the same form. */
export function withStrength(row: FormFields, strength: string): FormFields {
  const followsDefault =
    !row.dose.trim() || row.dose.trim() === defaultDose(row.form, row.strength);
  return {
    form: row.form,
    strength,
    dose: followsDefault ? defaultDose(row.form, strength) : row.dose,
  };
}

/**
 * The form a known strength belongs to, e.g. the clinic's core list naming
 * «100 мг/мл» for citicoline: the drops, not the first (injection) form.
 */
export function formOfStrength(
  forms: readonly DrugFormOption[],
  strength: string,
): string | null {
  const key = strengthKey(normalizeStrength(strength));
  return forms.find((f) => f.strengths.some((s) => strengthKey(s) === key))?.form ?? null;
}
