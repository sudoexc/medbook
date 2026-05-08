/**
 * Phase 18 Wave 4 — pure helpers for the scheduled-report cron.
 *
 * `computeNextRunAt` advances a `ScheduledReport.nextRunAt` value forward to
 * the next occurrence in the clinic's local timezone (Asia/Tashkent in
 * production). All scheduling targets the `09:00` local-clock hour — the
 * cadence anchor; the W4 spec deliberately keeps this fixed (no per-clinic
 * preferred hour yet) so the picker logic stays trivial.
 *
 * The arithmetic is performed by reading the `from` timestamp through
 * `Intl.DateTimeFormat` with the target `timeZone` to recover its civil
 * (Y, M, D, h, m) components, doing date math in the civil coordinates,
 * then converting the result back to UTC by binary-searching for the UTC
 * instant whose civil rendering in `timeZone` matches the desired wall
 * clock. Asia/Tashkent has no DST, so the rare DST-edge ambiguity never
 * fires for our deployment, but the helper is correct for arbitrary IANA
 * zones — the W4 unit tests exercise both Tashkent and Europe/Berlin.
 */
export type ScheduleCadence = "DAILY" | "WEEKLY" | "MONTHLY";

const RUN_HOUR = 9;
const RUN_MINUTE = 0;

interface CivilParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number;
  weekday: number; // 1=Mon .. 7=Sun
}

const PART_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
function partFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = PART_FORMATTER_CACHE.get(timeZone);
  if (cached) return cached;
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  PART_FORMATTER_CACHE.set(timeZone, f);
  return f;
}

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function getCivilParts(date: Date, timeZone: string): CivilParts {
  const parts = partFormatter(timeZone).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // Intl `hour: "2-digit"` with hour12:false can return "24" at midnight on
  // some runtimes; clamp to 0 to keep arithmetic sane.
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour,
    minute: parseInt(get("minute"), 10),
    second: parseInt(get("second"), 10),
    weekday: WEEKDAY_MAP[get("weekday")] ?? 1,
  };
}

/**
 * Convert a civil (Y, M, D, h, m) wall-clock spec in `timeZone` to the UTC
 * instant. Bisects on the UTC offset; correct for DST transitions. We pick
 * the earlier instant when an hour is doubled (DST fall-back) — Asia/Tashkent
 * has no DST so this is academic, but documented here so the UZ code is
 * still correct if a clinic ever runs in another zone.
 */
function civilToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // Start with a naive UTC guess (assume the civil time IS UTC).
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  // Refine twice — converges for any timezone offset within ±14h.
  for (let i = 0; i < 3; i++) {
    const civil = getCivilParts(guess, timeZone);
    const civilTs = Date.UTC(
      civil.year,
      civil.month - 1,
      civil.day,
      civil.hour,
      civil.minute,
      civil.second,
    );
    const targetTs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const offsetMs = civilTs - guess.getTime();
    const next = new Date(targetTs - offsetMs);
    if (next.getTime() === guess.getTime()) return guess;
    guess = next;
  }
  return guess;
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Compute the next firing time for a schedule.
 *
 * - DAILY → next day at 09:00 local. If `from` is already past 09:00 today
 *   we skip to tomorrow; if before 09:00 today, today.
 * - WEEKLY → next Monday at 09:00 local. If `from` is Monday before 09:00,
 *   today; otherwise jump to the following Monday.
 * - MONTHLY → first day of the next month at 09:00 local. If `from` is in
 *   the first hours of day-1 we still skip to next month so users don't get
 *   double-fired on month boundaries.
 */
export function computeNextRunAt(
  cadence: ScheduleCadence,
  from: Date,
  timeZone: string,
): Date {
  const civ = getCivilParts(from, timeZone);

  if (cadence === "DAILY") {
    const beforeAnchor =
      civ.hour < RUN_HOUR ||
      (civ.hour === RUN_HOUR && civ.minute < RUN_MINUTE);
    if (beforeAnchor) {
      return civilToUtc(civ.year, civ.month, civ.day, RUN_HOUR, RUN_MINUTE, timeZone);
    }
    // Tomorrow.
    let y = civ.year;
    let m = civ.month;
    let d = civ.day + 1;
    if (d > daysInMonth(y, m)) {
      d = 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return civilToUtc(y, m, d, RUN_HOUR, RUN_MINUTE, timeZone);
  }

  if (cadence === "WEEKLY") {
    // Monday = 1. Days until next Monday >= 1 always (we never re-schedule
    // for "right now"; either today-if-still-before-09:00 on a Monday, or
    // the following week).
    let addDays: number;
    if (civ.weekday === 1) {
      const beforeAnchor =
        civ.hour < RUN_HOUR ||
        (civ.hour === RUN_HOUR && civ.minute < RUN_MINUTE);
      addDays = beforeAnchor ? 0 : 7;
    } else {
      // Mon=1 .. Sun=7. days to Monday = (8 - weekday) % 7, but never 0.
      addDays = ((8 - civ.weekday) % 7) || 7;
    }
    let y = civ.year;
    let m = civ.month;
    let d = civ.day + addDays;
    while (d > daysInMonth(y, m)) {
      d -= daysInMonth(y, m);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return civilToUtc(y, m, d, RUN_HOUR, RUN_MINUTE, timeZone);
  }

  // MONTHLY → first of next month.
  // Why "next month" even when `from` is on day 1 already: a fresh schedule
  // created on Jan 31 should fire Feb 1, not Jan 31 again. End-of-month rollover
  // handled by the day=1-of-next-month math (no Feb 28 ambiguity).
  let nextY = civ.year;
  let nextM = civ.month + 1;
  if (nextM > 12) {
    nextM = 1;
    nextY += 1;
  }
  // Edge case: same-month tick-back. If the current civil moment is day 1
  // and BEFORE 09:00, we'd otherwise skip a whole month. Fire today instead.
  if (civ.day === 1) {
    const beforeAnchor =
      civ.hour < RUN_HOUR ||
      (civ.hour === RUN_HOUR && civ.minute < RUN_MINUTE);
    if (beforeAnchor) {
      return civilToUtc(civ.year, civ.month, 1, RUN_HOUR, RUN_MINUTE, timeZone);
    }
  }
  return civilToUtc(nextY, nextM, 1, RUN_HOUR, RUN_MINUTE, timeZone);
}

/**
 * Localised label for the cadence enum — wired into the UI list / preview.
 */
export function cadenceLabel(cadence: ScheduleCadence, locale: "ru" | "uz"): string {
  if (locale === "uz") {
    if (cadence === "DAILY") return "Har kuni";
    if (cadence === "WEEKLY") return "Har dushanba";
    return "Oylik (1-sana)";
  }
  if (cadence === "DAILY") return "Каждый день";
  if (cadence === "WEEKLY") return "Каждый понедельник";
  return "Каждое первое число";
}

export const RUN_ANCHOR = { hour: RUN_HOUR, minute: RUN_MINUTE };
