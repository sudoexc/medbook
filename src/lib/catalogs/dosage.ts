/**
 * Dosage builder primitives — types, label maps, formatter.
 *
 * The dosage builder is a deterministic, "from scratch" composer: doctor
 * picks drug + form + dose + frequency + timing + duration, and we render
 * a human-readable Russian/Uzbek line that gets pushed into
 * `VisitNote.prescriptions[]`. No LLM, no fuzz — what you click is what
 * gets printed.
 */

export type DrugForm =
  | "TAB"
  | "CAP"
  | "SYRUP"
  | "DROPS_ORAL"
  | "DROPS_NASAL"
  | "DROPS_EYE"
  | "DROPS_EAR"
  | "INJ_IM"
  | "INJ_IV"
  | "INJ_SC"
  | "OINT"
  | "CREAM"
  | "GEL"
  | "SUPP_RECT"
  | "SUPP_VAG"
  | "POWDER"
  | "INHAL"
  | "SPRAY"
  | "PATCH";

export type Frequency =
  | "1x_day"
  | "2x_day"
  | "3x_day"
  | "4x_day"
  | "every_4h"
  | "every_6h"
  | "every_8h"
  | "every_12h"
  | "every_other_day"
  | "weekly"
  | "as_needed"
  | "single";

export type Timing =
  | "before_meal"
  | "after_meal"
  | "with_meal"
  | "empty"
  | "morning"
  | "evening"
  | "bedtime"
  | "any";

export const FORM_LABELS_RU: Record<DrugForm, string> = {
  TAB: "таблетки",
  CAP: "капсулы",
  SYRUP: "сироп",
  DROPS_ORAL: "капли внутрь",
  DROPS_NASAL: "капли в нос",
  DROPS_EYE: "капли в глаза",
  DROPS_EAR: "капли в уши",
  INJ_IM: "в/м инъекции",
  INJ_IV: "в/в инъекции",
  INJ_SC: "п/к инъекции",
  OINT: "мазь",
  CREAM: "крем",
  GEL: "гель",
  SUPP_RECT: "ректальные свечи",
  SUPP_VAG: "вагинальные свечи",
  POWDER: "порошок",
  INHAL: "ингалятор",
  SPRAY: "спрей",
  PATCH: "пластырь",
};

export const FORM_LABELS_UZ: Record<DrugForm, string> = {
  TAB: "tabletka",
  CAP: "kapsula",
  SYRUP: "sirop",
  DROPS_ORAL: "ichish uchun tomchi",
  DROPS_NASAL: "burunga tomchi",
  DROPS_EYE: "koʻzga tomchi",
  DROPS_EAR: "quloqqa tomchi",
  INJ_IM: "muskul ichiga inyeksiya",
  INJ_IV: "vena ichiga inyeksiya",
  INJ_SC: "teri ostiga inyeksiya",
  OINT: "malham",
  CREAM: "krem",
  GEL: "gel",
  SUPP_RECT: "rektal sham",
  SUPP_VAG: "vaginal sham",
  POWDER: "kukun",
  INHAL: "ingalyator",
  SPRAY: "spray",
  PATCH: "plastir",
};

export const FREQ_LABELS_RU: Record<Frequency, string> = {
  "1x_day": "1 раз в день",
  "2x_day": "2 раза в день",
  "3x_day": "3 раза в день",
  "4x_day": "4 раза в день",
  every_4h: "каждые 4 часа",
  every_6h: "каждые 6 часов",
  every_8h: "каждые 8 часов",
  every_12h: "каждые 12 часов",
  every_other_day: "через день",
  weekly: "1 раз в неделю",
  as_needed: "по потребности",
  single: "однократно",
};

export const TIMING_LABELS_RU: Record<Timing, string> = {
  before_meal: "за 30 минут до еды",
  after_meal: "после еды",
  with_meal: "во время еды",
  empty: "натощак",
  morning: "утром",
  evening: "вечером",
  bedtime: "на ночь",
  any: "",
};

export type DosageInput = {
  drugName: string;
  form: DrugForm;
  /** Free-form dose like "500 мг", "5 мл", "1 капля". */
  dose: string;
  frequency: Frequency;
  timing: Timing;
  /** Free-form duration like "5 дней", "длительно", "при болях". */
  duration: string;
  /** Optional notes shown after duration: "при температуре", "перед сном", ... */
  note?: string;
};

/**
 * Compose a human-readable RU prescription line from structured input.
 *
 * Pattern:
 *   "{drug}, {form} {dose} — {frequency}{timing?}, {duration}{note?}"
 *
 * Empty parts (no timing, no duration) collapse cleanly so we never end
 * up with double commas or trailing spaces.
 */
export function formatDosageRu(d: DosageInput): string {
  const form = FORM_LABELS_RU[d.form];
  const freq = FREQ_LABELS_RU[d.frequency];
  const timing = TIMING_LABELS_RU[d.timing];

  const head = [d.drugName, [form, d.dose].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  const middle = [freq, timing].filter(Boolean).join(" ");

  const tail = [d.duration?.trim(), d.note?.trim()].filter(Boolean).join(", ");

  let line = `${head} — ${middle}`;
  if (tail) line += `, ${tail}`;
  return line;
}

/** Common quick-pick durations for the duration field. */
export const DURATION_QUICK_PICKS = [
  "3 дня",
  "5 дней",
  "7 дней",
  "10 дней",
  "14 дней",
  "1 месяц",
  "длительно",
  "до улучшения",
];
