/**
 * Ф2 (TZ-smart-constructor) — single source of truth for rendering a
 * structured VisitPrescription row as a human-readable line.
 *
 * Two lines, each the same everywhere it is used:
 *   - formatPatientLine, in words: the visit screen's rows, the print, the
 *     patient handout and the past visit page, so what the doctor sees on
 *     screen is what prints (doctor's request 10.10.2026, see below);
 *   - formatPrescriptionLine, compact: the doctor's own lists, protocols,
 *     revisions and the interaction check.
 */

export type PrescriptionTimeOfDay = "MORNING" | "NOON" | "EVENING" | "NIGHT";

export type PrescriptionMealRelation =
  | "BEFORE_MEAL"
  | "WITH_MEAL"
  | "AFTER_MEAL"
  | "EMPTY_STOMACH"
  | "NO_MATTER";

export type PrescriptionLocale = "ru" | "uz";

export type PrescriptionLikeRow = {
  displayName: string;
  strength?: string | null;
  dose: string;
  timesOfDay: readonly string[];
  mealRelation: string;
  durationDays?: number | null;
  /**
   * «Постоянно» (doctor's request 10.10.2026): taken with no end, for life.
   * Wins over a day count if both are somehow set.
   */
  ongoing?: boolean | null;
  instructionRu?: string | null;
  instructionUz?: string | null;
};

const TIME_ORDER: PrescriptionTimeOfDay[] = [
  "MORNING",
  "NOON",
  "EVENING",
  "NIGHT",
];

const TIME_LABELS: Record<
  PrescriptionLocale,
  Record<PrescriptionTimeOfDay, string>
> = {
  ru: {
    MORNING: "утром",
    NOON: "днём",
    EVENING: "вечером",
    NIGHT: "на ночь",
  },
  uz: {
    MORNING: "ertalab",
    NOON: "kunduzi",
    EVENING: "kechqurun",
    NIGHT: "uxlashdan oldin",
  },
};

const MEAL_LABELS: Record<PrescriptionLocale, Record<string, string>> = {
  ru: {
    BEFORE_MEAL: "до еды",
    WITH_MEAL: "во время еды",
    AFTER_MEAL: "после еды",
    EMPTY_STOMACH: "натощак",
  },
  uz: {
    BEFORE_MEAL: "ovqatdan oldin",
    WITH_MEAL: "ovqat bilan",
    AFTER_MEAL: "ovqatdan keyin",
    EMPTY_STOMACH: "och qoringa",
  },
};

// "утром и вечером" / "утром, днём и вечером"; uz joins with "va".
function joinHuman(parts: string[], locale: PrescriptionLocale): string {
  const and = locale === "uz" ? "va" : "и";
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;
}

// Skip strength in the head when the dose already carries it
// ("Конкор 5 мг — 5 мг" → "Конкор — 5 мг").
export function formatPrescriptionHead(
  row: Pick<PrescriptionLikeRow, "displayName" | "strength" | "dose">,
): string {
  const strength = row.strength?.trim() || null;
  const dose = row.dose.trim();
  return strength && dose !== strength && !row.displayName.includes(strength)
    ? `${row.displayName} ${strength}`
    : row.displayName;
}

export function formatMealLabel(
  mealRelation: string,
  locale: PrescriptionLocale,
): string {
  return MEAL_LABELS[locale][mealRelation] ?? "";
}

export function formatDurationDays(
  durationDays: number | null | undefined,
  locale: PrescriptionLocale,
  ongoing?: boolean | null,
): string {
  if (ongoing) return locale === "uz" ? "doimiy" : "постоянно";
  if (durationDays == null) return "";
  return locale === "uz" ? `${durationDays} kun` : `${durationDays} дн.`;
}

/**
 * The part of the line after the name: «1 таб., утром и вечером, после еды,
 * 10 дн.» («…, постоянно» for a lifelong course). Empty when the row has none
 * of it. The visit screen's picker shows it under a drug as the doctor's
 * usual way of writing it.
 */
export function formatPrescriptionSchedule(
  row: Pick<
    PrescriptionLikeRow,
    "dose" | "timesOfDay" | "mealRelation" | "durationDays" | "ongoing"
  >,
  locale: PrescriptionLocale,
): string {
  const dose = row.dose.trim();
  const times = TIME_ORDER.filter((t) => row.timesOfDay.includes(t)).map(
    (t) => TIME_LABELS[locale][t],
  );
  const meal = formatMealLabel(row.mealRelation, locale);
  const duration = formatDurationDays(row.durationDays, locale, row.ongoing);
  return [dose, joinHuman(times, locale), meal, duration]
    .filter(Boolean)
    .join(", ");
}

export function formatPrescriptionLine(
  row: PrescriptionLikeRow,
  locale: PrescriptionLocale,
  opts?: { withInstruction?: boolean },
): string {
  const head = formatPrescriptionHead(row);
  const schedule = formatPrescriptionSchedule(row, locale);

  let line = schedule ? `${head} — ${schedule}` : head;

  if (opts?.withInstruction) {
    // Each language falls back on the other (audit VW-20): the constructor
    // edits only the field of the doctor's interface language, so an
    // instruction typed on the Uzbek screen lives in instructionUz alone and
    // vanished from the Russian print. The doctor's words in the other
    // language beat no instruction at all.
    const instruction =
      locale === "uz"
        ? row.instructionUz?.trim() || row.instructionRu?.trim()
        : row.instructionRu?.trim() || row.instructionUz?.trim();
    if (instruction) {
      line += line.endsWith(".") ? ` ${instruction}` : `. ${instruction}`;
    }
  }
  return line;
}

export function formatPrescriptionLines(
  rows: readonly PrescriptionLikeRow[],
  locale: PrescriptionLocale,
  opts?: { withInstruction?: boolean },
): string[] {
  return rows.map((r) => formatPrescriptionLine(r, locale, opts));
}

// ─────────────────────────────────────────────────────────────────────────────
// The line the patient reads (doctor's request 10.10.2026): the intake grid
// «Утро | День | Вечер | Ночь» was hard to understand, he wants words, «2
// таблетки в день, утром после еды и вечером после еды». So the print, the
// handout and the visit screen's rows say «Карбамазепин 200 мг — по 1
// таблетке 2 раза в день: утром и вечером после еды, курс 10 дней». The
// compact line above stays for the doctor's own lists and the checks.
// ─────────────────────────────────────────────────────────────────────────────

/** Russian plural: one, few (2-4), many (5-20). */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

// A counted unit in the doctor's dose, written for the patient: «по» takes
// the dative for 1 (21, 31…), the genitive for 2-4 and 5+ («по 1 таблетке»,
// «по 2 таблетки», «по 5 таблеток», «по ½ таблетки»). Either language's
// spelling is known, so a dose typed on the other screen reads right too.
type CountedUnit = {
  re: RegExp;
  /** Dative singular, genitive singular, genitive plural, after a fraction. */
  ru: [string, string, string, string];
  uz: string;
};

const COUNTED_UNITS: CountedUnit[] = [
  { re: /^(?:таб|табл|таблет\p{L}*|tab|tabletka\p{L}*)\.?$/iu, ru: ["таблетке", "таблетки", "таблеток", "таблетки"], uz: "tabletka" },
  { re: /^(?:капс|капсул\p{L}*|kapsula\p{L}*)\.?$/iu, ru: ["капсуле", "капсулы", "капсул", "капсулы"], uz: "kapsula" },
  { re: /^(?:кап|капл\p{L}*|капель|tomchi\p{L}*)\.?$/iu, ru: ["капле", "капли", "капель", "капли"], uz: "tomchi" },
  { re: /^(?:свеч\p{L}*|sham\p{L}*)$/iu, ru: ["свече", "свечи", "свечей", "свечи"], uz: "sham" },
  { re: /^(?:амп|ампул\p{L}*|ampula\p{L}*)\.?$/iu, ru: ["ампуле", "ампулы", "ампул", "ампулы"], uz: "ampula" },
  { re: /^(?:пакетик\p{L}*|paketcha\p{L}*)$/iu, ru: ["пакетику", "пакетика", "пакетиков", "пакетика"], uz: "paketcha" },
  { re: /^(?:впрыск\p{L}*|purkash\p{L}*)$/iu, ru: ["впрыску", "впрыска", "впрысков", "впрыска"], uz: "purkash" },
  { re: /^(?:вдох\p{L}*|nafas\p{L}*)$/iu, ru: ["вдоху", "вдоха", "вдохов", "вдоха"], uz: "nafas" },
  { re: /^(?:пластыр\p{L}*|plastir\p{L}*)$/iu, ru: ["пластырю", "пластыря", "пластырей", "пластыря"], uz: "plastir" },
  { re: /^(?:доз[аыу]?|доз|doza\p{L}*)$/iu, ru: ["дозе", "дозы", "доз", "дозы"], uz: "doza" },
];

/**
 * One number of a dose: whole or decimal («1», «0,25»), a fraction sign
 * («½», «¼», «¾», doctor's request 10.10.2026: a quarter tablet), a fraction
 * typed with a slash («1/4») or a whole with a fraction sign («1½»).
 */
const NUM = String.raw`(?:\d+\s?[½¼¾]|[½¼¾]|\d+\/\d+|\d+(?:[.,]\d+)?)`;

/** An amount with its unit: «1 таб.», «¼ таблетки», «1-2 таб.», «400 мг». */
const AMOUNT = new RegExp(String.raw`^(${NUM}(?:\s*[-–]\s*${NUM})?)\s*(.*)$`, "u");

/** «мг», «мл», «ЕД»: abbreviations read the same after «по». */
const ABBREVIATION = /^(?:мг|г|мкг|мл|л|ед|ме|mg|g|mcg|ml|iu|%)$|\.$/iu;

function ruDosePart(dose: string): string {
  const m = AMOUNT.exec(dose);
  // Words alone («тонким слоем», «по схеме») stay as written.
  if (!m) return dose;
  const [, amount, rest] = m;
  const unit = rest ? COUNTED_UNITS.find((u) => u.re.test(rest)) : undefined;
  // A range («1-2») takes the form of its last number.
  const last = amount.split(/[-–]/).pop()!.trim();
  const whole = /^\d+$/.test(last);
  if (unit) {
    const [one, few, many, part] = unit.ru;
    return `по ${amount} ${whole ? ruPlural(Number(last), one, few, many) : part}`;
  }
  // A word the declension above does not know, after a count ending in 1
  // («1 чайная ложка»): without «по» it reads right, with it it does not.
  const firstWord = rest.split(/\s+/)[0] ?? "";
  if (whole && firstWord && !ABBREVIATION.test(firstWord) && ruPlural(Number(last), "one", "", "") === "one") {
    return dose;
  }
  return `по ${dose}`;
}

function uzDosePart(dose: string): string {
  const m = AMOUNT.exec(dose);
  const unit = m?.[2] ? COUNTED_UNITS.find((u) => u.re.test(m[2])) : undefined;
  return m && unit ? `${m[1]} ${unit.uz}` : dose;
}

/**
 * When, with the meal: «утром после еды», «утром после еды и вечером после
 * еды» (the doctor's own words), «утром, днём и вечером, каждый раз после
 * еды». A meal written once after a list read as if only the last time had it.
 */
function whenWithMeal(times: string[], meal: string, locale: PrescriptionLocale): string {
  if (!meal) return joinHuman(times, locale);
  if (times.length === 0) return meal;
  if (times.length <= 2) return joinHuman(times.map((t) => `${t} ${meal}`), locale);
  const each = locale === "uz" ? "har safar" : "каждый раз";
  return `${joinHuman(times, locale)}, ${each} ${meal}`;
}

/**
 * «по 1 таблетке 2 раза в день: утром после еды и вечером после еды, курс
 * 10 дней»; «1 tabletka, kuniga 2 marta: ertalab ovqatdan keyin va
 * kechqurun ovqatdan keyin, 10 kun davomida». A lifelong course ends «,
 * постоянно» / «, doimiy ravishda». Empty when the row has none.
 */
export function formatPatientSchedule(
  row: Pick<
    PrescriptionLikeRow,
    "dose" | "timesOfDay" | "mealRelation" | "durationDays" | "ongoing"
  >,
  locale: PrescriptionLocale,
): string {
  const dose = row.dose.trim();
  const times = TIME_ORDER.filter((t) => row.timesOfDay.includes(t)).map(
    (t) => TIME_LABELS[locale][t],
  );
  const meal = formatMealLabel(row.mealRelation, locale);
  const n = times.length;
  const when = whenWithMeal(times, meal, locale);

  if (locale === "uz") {
    const intake = n >= 2 ? `kuniga ${n} marta: ${when}` : when;
    const course = row.ongoing
      ? "doimiy ravishda"
      : row.durationDays != null
        ? `${row.durationDays} kun davomida`
        : "";
    return [dose ? uzDosePart(dose) : "", intake, course].filter(Boolean).join(", ");
  }

  const intake =
    n >= 2 ? `${n} ${ruPlural(n, "раз", "раза", "раз")} в день: ${when}` : when;
  const amount = dose ? ruDosePart(dose) : "";
  // A bare number («1», «1-2») next to «2 раза» would read as one number.
  const sep = /[\d½¼¾]$/u.test(amount) && /^\d/.test(intake) ? ", " : " ";
  const course = row.ongoing
    ? "постоянно"
    : row.durationDays != null
      ? `курс ${row.durationDays} ${ruPlural(row.durationDays, "день", "дня", "дней")}`
      : "";
  const head = amount && intake ? `${amount}${sep}${intake}` : amount || intake;
  return [head, course].filter(Boolean).join(", ");
}

export function formatPatientLine(
  row: PrescriptionLikeRow,
  locale: PrescriptionLocale,
  opts?: { withInstruction?: boolean },
): string {
  const head = formatPrescriptionHead(row);
  const schedule = formatPatientSchedule(row, locale);
  let line = schedule ? `${head} — ${schedule}` : head;
  if (opts?.withInstruction) {
    // Either language falls back on the other, as in formatPrescriptionLine.
    const instruction =
      locale === "uz"
        ? row.instructionUz?.trim() || row.instructionRu?.trim()
        : row.instructionRu?.trim() || row.instructionUz?.trim();
    if (instruction) {
      // A sentence of its own: «… курс 10 дней. На поражённые участки».
      const sentence = instruction.charAt(0).toUpperCase() + instruction.slice(1);
      line += line.endsWith(".") ? ` ${sentence}` : `. ${sentence}`;
    }
  }
  return line;
}

export function formatPatientLines(
  rows: readonly PrescriptionLikeRow[],
  locale: PrescriptionLocale,
  opts?: { withInstruction?: boolean },
): string[] {
  return rows.map((r) => formatPatientLine(r, locale, opts));
}
