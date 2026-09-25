/**
 * Clinic-day anchors for Action Center timers.
 *
 * The server runs in UTC while the clinic lives on Asia/Tashkent (UTC+5, no
 * DST). A timer that means "tomorrow morning" or "a week before the control
 * visit" must land on the clinic's wall clock, not on UTC: `setUTCHours(9)`
 * is 14:00 in Tashkent, halfway through the working day (audit AC-01).
 */
import {
  tashkentComponents,
  tashkentDayBounds,
  tashkentDayBoundsForDateString,
  toTashkentDate,
} from "@/lib/booking-validation";

/** The CRM's canonical start of the business day, clinic wall clock. */
export const CLINIC_MORNING = "09:00";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 09:00 clinic time on the clinic day that follows `now`. */
export function nextClinicMorning(now: Date): Date {
  const tomorrow = tashkentComponents(tashkentDayBounds(now).dayEnd).date;
  return toTashkentDate(tomorrow, CLINIC_MORNING);
}

/**
 * 09:00 clinic time, `leadDays` clinic days before the `YYYY-MM-DD` date.
 * Used to surface a task ahead of its due date instead of the day it is
 * created (a 30-day control visit should not sit in the list for a month).
 */
export function clinicMorningBefore(dateKey: string, leadDays: number): Date {
  const { dayStart } = tashkentDayBoundsForDateString(dateKey);
  const leadDay = tashkentComponents(
    new Date(dayStart.getTime() - leadDays * DAY_MS),
  ).date;
  return toTashkentDate(leadDay, CLINIC_MORNING);
}

/**
 * [start, end) of the clinic's calendar day containing `now`, in the clinic's
 * own timezone (`Clinic.timezone`). The risk-today list and its outcome
 * endpoint both use it, so an outcome is accepted exactly for the day the
 * list shows.
 */
export function clinicTodayBounds(now: Date, tz: string): { start: Date; end: Date } {
  // Resolve the clinic's local calendar date and TZ offset at `now`, then
  // back-solve the UTC instant of midnight in that TZ. Using only standard
  // Intl APIs to avoid adding `date-fns-tz` for one helper.
  let y: string | undefined;
  let m: string | undefined;
  let d: string | undefined;
  let offName: string | undefined;
  try {
    const dateParts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz,
    }).formatToParts(now);
    y = dateParts.find((p) => p.type === "year")?.value;
    m = dateParts.find((p) => p.type === "month")?.value;
    d = dateParts.find((p) => p.type === "day")?.value;
    const offParts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(now);
    offName = offParts.find((p) => p.type === "timeZoneName")?.value;
  } catch {
    // Bad tz string → fall through to UTC bounds below.
  }
  if (!y || !m || !d) {
    const fallback = new Date(now);
    fallback.setUTCHours(0, 0, 0, 0);
    return {
      start: fallback,
      end: new Date(fallback.getTime() + 24 * 60 * 60 * 1000),
    };
  }
  let offMin = 0;
  const oh = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(offName ?? "");
  if (oh) {
    const sign = oh[1] === "-" ? -1 : 1;
    offMin = sign * (parseInt(oh[2]!, 10) * 60 + parseInt(oh[3] ?? "0", 10));
  }
  const localMidnightUtc =
    Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)) -
    offMin * 60 * 1000;
  return {
    start: new Date(localMidnightUtc),
    end: new Date(localMidnightUtc + 24 * 60 * 60 * 1000),
  };
}
