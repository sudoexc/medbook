/**
 * «Контрольный визит»: when the patient is to come back.
 *
 * The doctor either says «через N дней» (a preset or any typed number) or
 * names the day itself (clinic request 29.09.2026). A note holds exactly one
 * of the two:
 *
 *   days  `followUpDays` = N, `followUpDate` null. Counted from the signature
 *         (a draft's estimate counts from today) in Tashkent CALENDAR days:
 *         «через 7 дн.» signed at 23:30 is the same weekday next week, where
 *         7 × 24h from a UTC server could land a day off.
 *   date  `followUpDate` = that day. `followUpDays` keeps the distance from
 *         the day it was picked, so a reader that knows only the days (an
 *         older build, a report) still gets a close answer.
 *
 * Every reader (the visit screen, print, the patient PDF, the Mini App, the
 * reception task) asks `followUpDue` here, so the day cannot drift between
 * them. Pure and client-safe.
 */
import { formatDate, type Locale } from "@/lib/format";
import { addTashkentDays, tashkentDateOf } from "@/lib/tashkent-time";

export const FOLLOW_UP_MIN_DAYS = 1;
/** Also the farthest exact date: a year ahead, so the two modes agree. */
export const FOLLOW_UP_MAX_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type FollowUpFields = {
  followUpDays?: number | null;
  /** The DATE column (a Date at UTC midnight) or its JSON / YYYY-MM-DD form. */
  followUpDate?: Date | string | null;
};

export type FollowUpDue = {
  /** Tashkent calendar day, YYYY-MM-DD. */
  date: string;
  /** The doctor named this very day: shown without «≈». */
  exact: boolean;
  /** The «через N дн.» count; null for an exact date. */
  days: number | null;
};

/** A real calendar day written as YYYY-MM-DD (no 2026-02-30). */
export function isDateKey(value: string): boolean {
  const m = DATE_KEY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/**
 * The stored follow-up date as YYYY-MM-DD, or null. A DATE column comes back
 * from Prisma as UTC midnight and reaches the browser as its ISO string, so
 * the UTC calendar part IS the day; converting it through a timezone would
 * move it.
 */
export function followUpDateKey(
  value: Date | string | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const key = value.slice(0, 10);
  return isDateKey(key) ? key : null;
}

/** The value to write into the DATE column for a YYYY-MM-DD day. */
export function followUpDateValue(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/**
 * An instant inside the given Tashkent day (its noon), for formatters that
 * take a Date and for the Mini App's ISO field. Noon keeps the calendar day
 * wherever the viewer's clock is between UTC-7 and UTC+14, not only on a
 * formatter pinned to Tashkent.
 */
export function followUpDayInstant(key: string): Date {
  return new Date(`${key}T12:00:00+05:00`);
}

/** Whole calendar days from one Tashkent day to another. */
export function tashkentDayDistance(fromKey: string, toKey: string): number {
  return Math.round(
    (followUpDayInstant(toKey).getTime() - followUpDayInstant(fromKey).getTime()) /
      DAY_MS,
  );
}

/**
 * When the patient is due back, or null when the note plans no control
 * visit. `anchor` is what «через N дней» counts from: the signature
 * (`finalizedAt`), falling back to `now` for a draft.
 */
export function followUpDue(
  fields: FollowUpFields,
  anchor?: Date | string | number | null,
  now: Date = new Date(),
): FollowUpDue | null {
  const exact = followUpDateKey(fields.followUpDate);
  if (exact) return { date: exact, exact: true, days: null };
  const days = fields.followUpDays;
  if (days == null || !Number.isFinite(days) || days <= 0) return null;
  const from =
    anchor != null && Number.isFinite(new Date(anchor).getTime()) ? anchor : now;
  return {
    date: addTashkentDays(tashkentDateOf(from), days),
    exact: false,
    days,
  };
}

/** The days an exact date may be picked from: tomorrow to a year ahead. */
export function followUpDateBounds(now: Date = new Date()): {
  min: string;
  max: string;
} {
  const today = tashkentDateOf(now);
  return {
    min: addTashkentDays(today, 1),
    max: addTashkentDays(today, FOLLOW_UP_MAX_DAYS),
  };
}

/**
 * Why an exact date cannot be the control visit, or null when it can.
 * Today counts as past: a control visit is a return, and reception needs
 * at least a day to call.
 */
export type FollowUpDateProblem = "invalid" | "past" | "too_far";

export function followUpDateProblem(
  key: string,
  now: Date = new Date(),
): FollowUpDateProblem | null {
  if (!isDateKey(key)) return "invalid";
  const { min, max } = followUpDateBounds(now);
  if (key < min) return "past";
  if (key > max) return "too_far";
  return null;
}

export function isFollowUpDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= FOLLOW_UP_MIN_DAYS &&
    value <= FOLLOW_UP_MAX_DAYS
  );
}

/**
 * The doctor's typed «через [N] дн.»: a whole number of days in range, or
 * null (empty, letters, 0, more than a year).
 */
export function parseFollowUpDays(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const n = Number(text);
  return isFollowUpDays(n) ? n : null;
}

export type FollowUpWrite = {
  followUpDays?: number | null;
  followUpDate?: Date | null;
};

/**
 * What a PATCH writes for the follow-up fields it was sent, keeping exactly
 * one mode active:
 *   - a date: stored, and the days become its distance from today;
 *   - days without a date: stored, and a date held before is cleared (a
 *     preset or a typed number replaces an exact day);
 *   - null for both (the × in the card): no control visit.
 * Only the fields that change are returned, so a note without a date does
 * not report `followUpDate` as edited.
 */
export function resolveFollowUpWrite(
  input: { followUpDays?: number | null; followUpDate?: string | null },
  before: { followUpDate?: Date | string | null },
  now: Date = new Date(),
):
  | { ok: true; data: FollowUpWrite }
  | { ok: false; problem: FollowUpDateProblem } {
  const data: FollowUpWrite = {};
  if (typeof input.followUpDate === "string") {
    const problem = followUpDateProblem(input.followUpDate, now);
    if (problem) return { ok: false, problem };
    data.followUpDate = followUpDateValue(input.followUpDate);
    data.followUpDays = tashkentDayDistance(
      tashkentDateOf(now),
      input.followUpDate,
    );
    return { ok: true, data };
  }
  if (input.followUpDays !== undefined) data.followUpDays = input.followUpDays;
  const clearsDate =
    input.followUpDate === null || input.followUpDays !== undefined;
  if (clearsDate && followUpDateKey(before.followUpDate) !== null) {
    data.followUpDate = null;
  }
  return { ok: true, data };
}

/**
 * The printed line: «через 14 дн. · ≈ 13.10.2026» for a count of days (the
 * day is an estimate: reception books what is free around it), just the
 * date for a day the doctor named.
 */
export function formatFollowUpLine(due: FollowUpDue, locale: Locale): string {
  const dateStr = formatDate(followUpDayInstant(due.date), locale, "short");
  if (due.exact) return dateStr;
  return locale === "uz"
    ? `${due.days} kundan keyin · ≈ ${dateStr}`
    : `через ${due.days} дн. · ≈ ${dateStr}`;
}
