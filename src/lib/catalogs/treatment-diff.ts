/**
 * Ф7 (TZ-smart-constructor) — детерминированный дифф лечения.
 *
 * Сравнивает структурные назначения (VisitPrescription) нового визита с
 * прошлым и выдаёт строки вида «↑ доза Конкор: 5 мг → 10 мг · отменено: Y ·
 * добавлено: Z». Никакого AI — для хроника это самая ценная строка
 * документа, поэтому она обязана быть воспроизводимой.
 *
 * Используется print-роутом заключения/памятки; чистые функции — живут в
 * src/lib, чтобы клиент мог переиспользовать без серверных импортов.
 *
 * Audit VW-05: a drug is not always continued as a structured row. A
 * template, a protocol or a free-typed history line puts it on the visit as
 * a text line (VisitNote.prescriptions), and the diff, which saw only the
 * structured rows, printed «отменено: Конкор» under a prescription list
 * that says «Конкор 5 мг», on the signed conclusion and on the patient's
 * handout. Text lines of both visits now take part: a drug named by a line
 * of the other visit is continued, neither stopped nor new. A line only
 * speaks for its drug, never for a dose, so no dose change is read from it.
 */

export type TreatmentDiffLocale = "ru" | "uz";

export type TreatmentDiffRow = {
  drugId?: string | null;
  displayName: string;
  strength?: string | null;
  dose: string;
  timesOfDay: readonly string[];
  mealRelation: string;
  durationDays?: number | null;
  /** «Постоянно»: taken with no end (10.10.2026). */
  ongoing?: boolean | null;
};

/**
 * A free-text prescription line of a visit, with the catalog drug it names
 * when the caller could resolve it (the print route does, by the same text
 * matcher as the drug check). Without an id the line matches by name.
 */
export type TreatmentDiffLine = { text: string; drugId?: string | null };

export type TreatmentDiffEntry =
  | { kind: "ADDED"; name: string }
  | { kind: "REMOVED"; name: string }
  | {
      kind: "DOSE_CHANGED";
      name: string;
      from: string;
      to: string;
      direction: "UP" | "DOWN" | "NONE";
    }
  | { kind: "SCHEDULE_CHANGED"; name: string };

function normText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

const FRACTION_SIGNS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };

/**
 * The first amount of a dose, fractions understood (doctor's request
 * 10.10.2026: a quarter tablet): «¼ таб.» 0.25, «1/4» 0.25, «1½» 1.5,
 * «0,25» 0.25, «1 таб.» 1. So «1 таб. → ¼ таб.» reads as a lower dose.
 *
 * A slash is a tablet split only as one: a single digit over 2, 3 or 4,
 * smaller than it («1/4», «2/3», «3/4»). Anything else with a slash is a
 * combination strength («Эксфорж 5/160 мг», «160/12,5 мг») and reads its
 * first number, as before the split was understood: dividing it printed
 * «↓ доза» on «5/80 → 5/160 мг», an increase.
 */
function firstNumber(value: string): number | null {
  const m =
    /(\d+)?\s?([½¼¾])|(?<![\d.,])([1-3])\/([2-4])(?![\d.,])|(\d+(?:[.,]\d+)?)/u.exec(
      value,
    );
  if (!m) return null;
  if (m[2]) return (m[1] ? Number(m[1]) : 0) + FRACTION_SIGNS[m[2]];
  if (m[3]) {
    const num = Number(m[3]);
    const den = Number(m[4]);
    return num < den ? num / den : num;
  }
  return Number.parseFloat(m[5].replace(",", "."));
}

/** Words of a name or line: case, ё, punctuation and ® folded away. */
function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * The names a structured row goes by: its label, the label without the
 * bracket, and what the bracket holds («Конкор (бисопролол)» → «конкор
 * бисопролол», «конкор», «бисопролол»).
 */
function rowNames(row: TreatmentDiffRow): string[][] {
  const label = row.displayName;
  const names = [label, label.replace(/\([^)]*\)/g, " ")];
  for (const m of label.matchAll(/\(([^)]*)\)/g)) names.push(m[1]!);
  return names.map(words).filter((w) => w.length > 0);
}

type LineRef = { words: string[]; drugId: string | null };

function toLineRefs(
  lines: readonly (string | TreatmentDiffLine)[] | undefined,
): LineRef[] {
  return (lines ?? []).map((l) =>
    typeof l === "string"
      ? { words: words(l), drugId: null }
      : { words: words(l.text), drugId: l.drugId ?? null },
  );
}

/**
 * Does a text line name this row's drug? The same catalog drug, or a line
 * that starts with one of the row's names as whole words («Конкор 5 мг,
 * по 1 таб утром» names «Конкор (бисопролол)»).
 */
function lineNamesRow(line: LineRef, row: TreatmentDiffRow): boolean {
  if (line.drugId && row.drugId && line.drugId === row.drugId) return true;
  return rowNames(row).some(
    (name) =>
      name.length <= line.words.length &&
      name.every((w, i) => line.words[i] === w),
  );
}

/**
 * Does this text line name the drug? The rule the diff continues a drug by
 * (VW-05), for the medication bridge: a lifelong course is stopped only when
 * its doctor's next visit names the drug nowhere, the same «отменено» the
 * print reports.
 */
export function lineNamesDrug(
  line: string | TreatmentDiffLine,
  drug: { drugId?: string | null; displayName: string },
): boolean {
  const [ref] = toLineRefs([line]);
  return lineNamesRow(ref!, {
    drugId: drug.drugId ?? null,
    displayName: drug.displayName,
    dose: "",
    timesOfDay: [],
    mealRelation: "",
  });
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/**
 * Match prev↔next rows: drugId wins, then normalized displayName. Each prev
 * row is consumed at most once, so duplicates stay deterministic.
 *
 * `lines` are the text lines of each visit (VW-05): a structured row of one
 * visit named by a line of the other is continued, not stopped or new.
 */
export function diffTreatments(
  prev: readonly TreatmentDiffRow[],
  next: readonly TreatmentDiffRow[],
  lines?: {
    prev?: readonly (string | TreatmentDiffLine)[];
    next?: readonly (string | TreatmentDiffLine)[];
  },
): TreatmentDiffEntry[] {
  const prevLines = toLineRefs(lines?.prev);
  const nextLines = toLineRefs(lines?.next);
  const consumed = new Set<number>();

  const findMatch = (row: TreatmentDiffRow): number => {
    if (row.drugId) {
      const byId = prev.findIndex(
        (p, i) => !consumed.has(i) && p.drugId === row.drugId,
      );
      if (byId !== -1) return byId;
    }
    const name = normText(row.displayName);
    return prev.findIndex(
      (p, i) => !consumed.has(i) && normText(p.displayName) === name,
    );
  };

  const changed: TreatmentDiffEntry[] = [];
  const added: TreatmentDiffEntry[] = [];

  for (const row of next) {
    const matchIdx = findMatch(row);
    if (matchIdx === -1) {
      // Written as a text line last time, as a row now: continued.
      if (prevLines.some((l) => lineNamesRow(l, row))) continue;
      added.push({ kind: "ADDED", name: row.displayName });
      continue;
    }
    consumed.add(matchIdx);
    const before = prev[matchIdx];

    // Dose comparison: strength is the per-unit dimension («5 мг»), dose is
    // the intake amount («1 таб»). A change in either is a dose change;
    // strength wins the from→to label because that's what «↑ доза 5→10 мг»
    // means clinically.
    const strengthChanged =
      normText(before.strength) !== normText(row.strength);
    const doseChanged = normText(before.dose) !== normText(row.dose);
    if (strengthChanged || doseChanged) {
      const from = strengthChanged
        ? (before.strength ?? "").trim() || before.dose.trim()
        : before.dose.trim();
      const to = strengthChanged
        ? (row.strength ?? "").trim() || row.dose.trim()
        : row.dose.trim();
      const a = firstNumber(from);
      const b = firstNumber(to);
      const direction: "UP" | "DOWN" | "NONE" =
        a != null && b != null && a !== b ? (b > a ? "UP" : "DOWN") : "NONE";
      changed.push({
        kind: "DOSE_CHANGED",
        name: row.displayName,
        from,
        to,
        direction,
      });
      continue;
    }

    const scheduleChanged =
      !sameStringSet(before.timesOfDay, row.timesOfDay) ||
      before.mealRelation !== row.mealRelation ||
      (before.durationDays ?? null) !== (row.durationDays ?? null) ||
      !!before.ongoing !== !!row.ongoing;
    if (scheduleChanged) {
      changed.push({ kind: "SCHEDULE_CHANGED", name: row.displayName });
    }
  }

  // A row of the last visit that this visit continues as a text line is
  // not stopped (VW-05).
  const removed: TreatmentDiffEntry[] = prev
    .filter(
      (p, i) => !consumed.has(i) && !nextLines.some((l) => lineNamesRow(l, p)),
    )
    .map((p) => ({ kind: "REMOVED", name: p.displayName }) as const);

  // TZ order: изменения → отменено → добавлено.
  return [...changed, ...removed, ...added];
}

const STRINGS: Record<
  TreatmentDiffLocale,
  {
    added: (name: string) => string;
    removed: (name: string) => string;
    dose: (name: string, from: string, to: string, arrow: string) => string;
    schedule: (name: string) => string;
  }
> = {
  ru: {
    // Нейтральный род («добавлено: Но-шпа») — без подгонки окончаний.
    added: (name) => `добавлено: ${name}`,
    removed: (name) => `отменено: ${name}`,
    dose: (name, from, to, arrow) =>
      `${arrow}доза ${name}: ${from} → ${to}`,
    schedule: (name) => `изменена схема приёма: ${name}`,
  },
  uz: {
    added: (name) => `qo‘shildi: ${name}`,
    removed: (name) => `bekor qilindi: ${name}`,
    dose: (name, from, to, arrow) =>
      `${arrow}${name} dozasi: ${from} → ${to}`,
    schedule: (name) => `qabul tartibi o‘zgardi: ${name}`,
  },
};

export function formatTreatmentDiffLine(
  entry: TreatmentDiffEntry,
  locale: TreatmentDiffLocale,
): string {
  const s = STRINGS[locale];
  switch (entry.kind) {
    case "ADDED":
      return s.added(entry.name);
    case "REMOVED":
      return s.removed(entry.name);
    case "SCHEDULE_CHANGED":
      return s.schedule(entry.name);
    case "DOSE_CHANGED": {
      const arrow =
        entry.direction === "UP"
          ? "↑ "
          : entry.direction === "DOWN"
            ? "↓ "
            : "";
      return s.dose(entry.name, entry.from, entry.to, arrow);
    }
  }
}

export function formatTreatmentDiff(
  entries: readonly TreatmentDiffEntry[],
  locale: TreatmentDiffLocale,
): string[] {
  return entries.map((e) => formatTreatmentDiffLine(e, locale));
}
