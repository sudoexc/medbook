/**
 * A doctor's working windows for one Tashkent calendar day.
 *
 * The schedule editor stores only working intervals (`updateDoctorSchedule`
 * replaces every row), so a day off is simply a weekday with no rows. Slot
 * generation used to fall back to 09:00–19:00 whenever the queried WEEKDAY
 * had no rows, which turned every day off into a full working day: a
 * Mon–Fri neurologist was bookable on Sunday from the Mini App and the CRM,
 * and the booking itself passed because the schedule check only ran when
 * rows existed (audit AP-01).
 *
 * The rule, shared by slot lists, booking validation and the public lead
 * form so they can never disagree:
 *   - the doctor has no active schedule row at all → the schedule was never
 *     set up; keep the legacy open day (`NO_SCHEDULE_FALLBACK`);
 *   - otherwise the day's windows are the rows for that weekday whose
 *     validity range (`validFrom` / `validTo`, either end optional) overlaps
 *     the day; none means a day off.
 *
 * Pure (no Prisma), so the public site can run it in the browser.
 */
import { tashkentDayBoundsForDateString } from "./booking-validation";

export type ScheduleRowLike = {
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom?: Date | string | null;
  validTo?: Date | string | null;
};

export type WorkingWindow = { start: string; end: string };

/** A doctor without any schedule keeps the historical open day. */
export const NO_SCHEDULE_FALLBACK: readonly WorkingWindow[] = [
  { start: "09:00", end: "19:00" },
];

function toMs(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  const ms = (v instanceof Date ? v : new Date(v)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param rows every ACTIVE schedule row of the doctor, all weekdays — the
 *   caller filters `isActive`; the weekday and validity are decided here.
 * @param dateStr the Tashkent calendar day, "YYYY-MM-DD".
 */
export function workingWindowsFor(
  rows: ReadonlyArray<ScheduleRowLike>,
  dateStr: string,
): WorkingWindow[] {
  if (rows.length === 0) return NO_SCHEDULE_FALLBACK.map((w) => ({ ...w }));
  const { dayStart, dayEnd } = tashkentDayBoundsForDateString(dateStr);
  // The calendar weekday of the date string itself (0 = Sunday, the
  // DoctorSchedule convention); UTC maths on a bare date never shifts days.
  const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const startMs = dayStart.getTime();
  const endMs = dayEnd.getTime();
  return rows
    .filter((r) => {
      if (r.weekday !== weekday) return false;
      const from = toMs(r.validFrom);
      const to = toMs(r.validTo);
      if (from !== null && from >= endMs) return false;
      if (to !== null && to < startMs) return false;
      return true;
    })
    .map((r) => ({ start: r.startTime, end: r.endTime }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** True when the doctor sees patients at all on that day. */
export function isWorkingDay(
  rows: ReadonlyArray<ScheduleRowLike>,
  dateStr: string,
): boolean {
  return workingWindowsFor(rows, dateStr).length > 0;
}

/**
 * Whether the public «request a visit» form may offer a calendar day. With a
 * doctor whose schedule is set up, the doctor's own working days decide, by
 * the rule above (days off closed). Without one (no doctor chosen, or no
 * schedule yet), Sunday stays the clinic's day off, as the form always had.
 */
export function isLeadDayOpen(
  dateStr: string,
  schedule: ReadonlyArray<ScheduleRowLike> | null | undefined,
): boolean {
  if (schedule && schedule.length > 0) return isWorkingDay(schedule, dateStr);
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay() !== 0;
}
