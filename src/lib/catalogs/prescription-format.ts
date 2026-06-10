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

export function formatPrescriptionLine(
  row: PrescriptionLikeRow,
  locale: PrescriptionLocale,
  opts?: { withInstruction?: boolean },
): string {
  const strength = row.strength?.trim() || null;
  const dose = row.dose.trim();

  // Skip strength in the head when the dose already carries it
  // ("Конкор 5 мг — 5 мг" → "Конкор — 5 мг").
  const head =
    strength && dose !== strength && !row.displayName.includes(strength)
      ? `${row.displayName} ${strength}`
      : row.displayName;

  const times = TIME_ORDER.filter((t) => row.timesOfDay.includes(t)).map(
    (t) => TIME_LABELS[locale][t],
  );
  const meal = MEAL_LABELS[locale][row.mealRelation] ?? "";
  const duration =
    row.durationDays != null
      ? locale === "uz"
        ? `${row.durationDays} kun`
        : `${row.durationDays} дн.`
      : "";

  const schedule = [dose, joinHuman(times, locale), meal, duration]
    .filter(Boolean)
    .join(", ");

  let line = schedule ? `${head} — ${schedule}` : head;

  if (opts?.withInstruction) {
    const instruction =
      locale === "uz"
        ? row.instructionUz?.trim() || row.instructionRu?.trim()
        : row.instructionRu?.trim();
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
