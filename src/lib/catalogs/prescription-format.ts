/**
 * Ф2 (TZ-smart-constructor) — single source of truth for rendering a
 * structured VisitPrescription row as a human-readable line.
 *
 * Used by the reception constructor (row preview), the print route and the
 * patient-handout composer feed — keep the format identical everywhere so
 * what the doctor sees on screen is what prints.
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
): string {
  if (durationDays == null) return "";
  return locale === "uz" ? `${durationDays} kun` : `${durationDays} дн.`;
}

/**
 * The part of the line after the name: «1 таб., утром и вечером, после еды,
 * 10 дн.». Empty when the row has none of it. The visit screen's picker
 * shows it under a drug as the doctor's usual way of writing it.
 */
export function formatPrescriptionSchedule(
  row: Pick<
    PrescriptionLikeRow,
    "dose" | "timesOfDay" | "mealRelation" | "durationDays"
  >,
  locale: PrescriptionLocale,
): string {
  const dose = row.dose.trim();
  const times = TIME_ORDER.filter((t) => row.timesOfDay.includes(t)).map(
    (t) => TIME_LABELS[locale][t],
  );
  const meal = formatMealLabel(row.mealRelation, locale);
  const duration = formatDurationDays(row.durationDays, locale);
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

// «по» + amount: «по 1 таблетке», «по 2 таблетки», «по 5 таблеток»,
// «по ½ таблетки»; the same for capsules.
const RU_UNITS: Array<{ re: RegExp; forms: [string, string, string, string] }> = [
  { re: /^(?:таб|табл|таблет\p{L}*)\.?$/iu, forms: ["таблетке", "таблетки", "таблеток", "таблетки"] },
  { re: /^(?:капс|капсул\p{L}*)\.?$/iu, forms: ["капсуле", "капсулы", "капсул", "капсулы"] },
];

function ruDosePart(dose: string): string {
  const m = /^(½|¼|\d+(?:[.,]\d+)?)\s*(\S+)$/u.exec(dose);
  if (m) {
    const unit = RU_UNITS.find((u) => u.re.test(m[2]));
    if (unit) {
      const whole = /^\d+$/.test(m[1]);
      const [one, few, many, part] = unit.forms;
      const word = whole ? ruPlural(Number(m[1]), one, few, many) : part;
      return `по ${m[1]} ${word}`;
    }
  }
  // «по 400 мг», «по 10 капель»; words alone («тонким слоем») stay as written.
  return /^[\d½¼]/u.test(dose) ? `по ${dose}` : dose;
}

/**
 * «по 1 таблетке 2 раза в день: утром и вечером после еды, курс 10 дней»;
 * «1 tabletka, kuniga 2 marta: ertalab va kechqurun ovqatdan keyin, 10 kun
 * davomida». Empty when the row has none of it.
 */
export function formatPatientSchedule(
  row: Pick<PrescriptionLikeRow, "dose" | "timesOfDay" | "mealRelation" | "durationDays">,
  locale: PrescriptionLocale,
): string {
  const dose = row.dose.trim();
  const times = TIME_ORDER.filter((t) => row.timesOfDay.includes(t)).map(
    (t) => TIME_LABELS[locale][t],
  );
  const meal = formatMealLabel(row.mealRelation, locale);
  const n = times.length;
  const when = joinHuman(times, locale);

  if (locale === "uz") {
    const freq = n >= 2 ? `kuniga ${n} marta: ${when}` : when;
    const intake = [freq, meal].filter(Boolean).join(" ");
    const course = row.durationDays != null ? `${row.durationDays} kun davomida` : "";
    return [dose, intake, course].filter(Boolean).join(", ");
  }

  const freq =
    n >= 2 ? `${n} ${ruPlural(n, "раз", "раза", "раз")} в день: ${when}` : when;
  const intake = [dose ? ruDosePart(dose) : "", freq, meal].filter(Boolean).join(" ");
  const course =
    row.durationDays != null
      ? `курс ${row.durationDays} ${ruPlural(row.durationDays, "день", "дня", "дней")}`
      : "";
  return [intake, course].filter(Boolean).join(", ");
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
      line += line.endsWith(".") ? ` ${instruction}` : `. ${instruction}`;
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
