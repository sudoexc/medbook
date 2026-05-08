/**
 * Pure helper: group timeline items by local-day, newest first.
 *
 * Used by the unified patient timeline (`patient-timeline.tsx`). Lives in
 * `src/lib/timeline/` so it can be unit-tested without React.
 *
 * Day key: `YYYY-MM-DD` in **local** time of the runtime — this matches how
 * we render relative day headers ("Сегодня" / "Вчера") on the client. The
 * key is used purely for grouping; the absolute `Date` is kept on each row
 * so the renderer can format it however it likes.
 */

export type DayLabel = "today" | "yesterday" | "absolute";

export interface DayGroupInput {
  at: string | Date;
}

export interface DayGroup<T extends DayGroupInput> {
  /** Local-time `YYYY-MM-DD` key for this day. */
  key: string;
  /** Representative date (the first item's `at`, parsed). */
  date: Date;
  /** Relative label vs `now` (today/yesterday/absolute). */
  label: DayLabel;
  /** Items belonging to this day, ordered as input. */
  items: T[];
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function relativeDayLabel(d: Date, now: Date): DayLabel {
  const dayDiff = Math.round(
    (startOfLocalDay(d).getTime() - startOfLocalDay(now).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  if (dayDiff === 0) return "today";
  if (dayDiff === -1) return "yesterday";
  return "absolute";
}

/**
 * Group items by local day, newest day first. Items inside each group keep
 * their input order — the caller is responsible for sorting them DESC by
 * `at` first if that matters.
 *
 * `now` is injectable for deterministic tests.
 */
export function groupByDay<T extends DayGroupInput>(
  items: T[],
  now: Date = new Date(),
): DayGroup<T>[] {
  const buckets = new Map<string, DayGroup<T>>();
  for (const it of items) {
    const d = it.at instanceof Date ? it.at : new Date(it.at);
    if (!Number.isFinite(d.getTime())) continue;
    const key = localDayKey(d);
    let group = buckets.get(key);
    if (!group) {
      group = {
        key,
        date: d,
        label: relativeDayLabel(d, now),
        items: [],
      };
      buckets.set(key, group);
    }
    group.items.push(it);
  }
  // Sort groups DESC by key (lexicographic order works for YYYY-MM-DD).
  return Array.from(buckets.values()).sort((a, b) =>
    a.key < b.key ? 1 : a.key > b.key ? -1 : 0,
  );
}
