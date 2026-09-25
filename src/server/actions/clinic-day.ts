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
