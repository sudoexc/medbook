/**
 * One-click doses for a prescription row.
 *
 * The visit screen's doctor works with the mouse (clinic request
 * 03.10.2026): a pick whose dose the catalog cannot give (drops, syrups,
 * injections, creams, see drug-forms.ts) used to stop at an empty field he
 * had to type into. These chips offer the doses that form is written in,
 * so the prompt is answered with a click; the field stays for anything else.
 *
 * The amounts come first from the drug itself (an ampoule of «2 мл», a
 * tablet of «500 мг»), then the usual amounts of the form. Written in the
 * interface language, like everything else the doctor writes on the row.
 *
 * Pure: shared by the constructor's dose prompt and row editor, and tested.
 */
import {
  isConcentrationOrPack,
  isUnitDose,
  isUnitForm,
  normalizeStrength,
} from "./drug-forms";

export type QuickDoseLocale = "ru" | "uz";

const BY_FORM: Record<string, Record<QuickDoseLocale, string[]>> = {
  TAB: {
    ru: ["1 таб.", "2 таб.", "½ таб."],
    uz: ["1 tabletka", "2 tabletka", "½ tabletka"],
  },
  CAP: {
    ru: ["1 капс.", "2 капс."],
    uz: ["1 kapsula", "2 kapsula"],
  },
  SYRUP: {
    ru: ["2,5 мл", "5 мл", "10 мл", "15 мл"],
    uz: ["2,5 ml", "5 ml", "10 ml", "15 ml"],
  },
  DROPS_ORAL: {
    ru: ["5 капель", "10 капель", "15 капель", "20 капель"],
    uz: ["5 tomchi", "10 tomchi", "15 tomchi", "20 tomchi"],
  },
  DROPS_EYE: {
    ru: ["1 капля", "2 капли"],
    uz: ["1 tomchi", "2 tomchi"],
  },
  DROPS_EAR: {
    ru: ["2 капли", "3 капли", "5 капель"],
    uz: ["2 tomchi", "3 tomchi", "5 tomchi"],
  },
  DROPS_NASAL: {
    ru: ["1 капля", "2 капли", "3 капли"],
    uz: ["1 tomchi", "2 tomchi", "3 tomchi"],
  },
  INJ_IM: {
    ru: ["1 амп.", "1 мл", "2 мл", "5 мл"],
    uz: ["1 ampula", "1 ml", "2 ml", "5 ml"],
  },
  INJ_IV: {
    ru: ["1 амп.", "2 мл", "5 мл", "10 мл"],
    uz: ["1 ampula", "2 ml", "5 ml", "10 ml"],
  },
  INJ_SC: {
    ru: ["1 мл", "0,5 мл"],
    uz: ["1 ml", "0,5 ml"],
  },
  POWDER: {
    ru: ["1 пакетик", "2 пакетика"],
    uz: ["1 paketcha", "2 paketcha"],
  },
  INHAL: {
    ru: ["1 вдох", "2 вдоха"],
    uz: ["1 nafas", "2 nafas"],
  },
  SPRAY: {
    ru: ["1 впрыск", "2 впрыска"],
    uz: ["1 purkash", "2 purkash"],
  },
  GEL: { ru: ["тонким слоем"], uz: ["yupqa qatlam"] },
  CREAM: { ru: ["тонким слоем"], uz: ["yupqa qatlam"] },
  OINT: { ru: ["тонким слоем"], uz: ["yupqa qatlam"] },
  SUPP_RECT: { ru: ["1 свеча"], uz: ["1 sham"] },
  SUPP_VAG: { ru: ["1 свеча"], uz: ["1 sham"] },
  PATCH: { ru: ["1 пластырь"], uz: ["1 plastir"] },
};

/** A drug without a form (a quick-added clinic drug, a manual row). */
const NO_FORM: Record<QuickDoseLocale, string[]> = {
  ru: ["1 таб.", "2 таб.", "1 капс.", "5 мл", "10 мл"],
  uz: ["1 tabletka", "2 tabletka", "1 kapsula", "5 ml", "10 ml"],
};

/** «2 мл», «10 мл», «0,5 мл»: one ampoule or one measure, given whole. */
const PLAIN_VOLUME = /^\d+(?:,\d+)?\s?(?:мл|ml)\.?$/iu;

/** At most this many chips: the prompt must stay one glance wide. */
const MAX_CHIPS = 6;

/**
 * The doses to offer for a row of `form` whose catalog strengths are
 * `strengths`, most specific first, without repeats.
 */
export function quickDoseOptions(
  form: string | null | undefined,
  strengths: readonly string[],
  locale: QuickDoseLocale,
): string[] {
  const fromDrug: string[] = [];
  for (const raw of strengths) {
    const s = normalizeStrength(raw);
    if (!s || isConcentrationOrPack(s)) continue;
    // A tablet of «500 мг» is a dose, and so is an ampoule of «2 мл». A
    // «100 мл» bottle is not: for a liquid only a measure up to 20 мл counts.
    if (isUnitForm(form) ? isUnitDose(s) : isSmallVolume(s)) fromDrug.push(s);
  }
  const generic = (form && BY_FORM[form]?.[locale]) || NO_FORM[locale];

  // Tablets and capsules: the count first, «1 таб.», with the strength left
  // in the drug's name («Карбамазепин 200 мг — по 1 таблетке», doctor's
  // request 10.10.2026); its first strengths follow, and the form and
  // strength picker above lists them all.
  const ordered = isUnitForm(form) ? [...generic, ...fromDrug] : [...fromDrug, ...generic];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dose of ordered) {
    const key = dose.toLowerCase().replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dose);
    if (out.length >= MAX_CHIPS) break;
  }
  return out;
}

function isSmallVolume(s: string): boolean {
  if (!PLAIN_VOLUME.test(s)) return false;
  const n = Number.parseFloat(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 20;
}
