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
};

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

function firstNumber(value: string): number | null {
  const m = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
  return m ? Number.parseFloat(m[0]) : null;
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/**
 * Match prev↔next rows: drugId wins, then normalized displayName. Each prev
 * row is consumed at most once, so duplicates stay deterministic.
 */
export function diffTreatments(
  prev: readonly TreatmentDiffRow[],
  next: readonly TreatmentDiffRow[],
): TreatmentDiffEntry[] {
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
      (before.durationDays ?? null) !== (row.durationDays ?? null);
    if (scheduleChanged) {
      changed.push({ kind: "SCHEDULE_CHANGED", name: row.displayName });
    }
  }

  const removed: TreatmentDiffEntry[] = prev
    .filter((_, i) => !consumed.has(i))
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
