/**
 * Limits and clock rules of the patient's own booking in the Mini App
 * (audit MA-14, MA-17).
 *
 * The booking API accepted any instant and any number of bookings: one
 * Telegram account could script every free slot of every neurologist three
 * weeks ahead, or close a doctor's day with one booking of ten services, and
 * real patients saw «нет свободного времени». The wizard offers 14 days on a
 * 20 minute grid; the server now holds a booking to the same frame, and a
 * patient to a few active bookings.
 *
 * Every day here is a Tashkent calendar day and every time a Tashkent wall
 * clock «HH:mm», whatever the phone's own zone: a daughter in Moscow booking
 * her mother «10:00» means 10:00 at the clinic.
 *
 * Client-safe: no server imports.
 */
import { addTashkentDays, tashkentDateOf } from "@/lib/tashkent-time";

/** Days the patient may book ahead, today included (the wizard's strip). */
export const MINIAPP_BOOKING_HORIZON_DAYS = 14;

/** Services one Mini App booking may carry (the wizard sends one). */
export const MINIAPP_MAX_SERVICES_PER_BOOKING = 3;

/** Booked visits ahead a patient may hold at once from the Mini App. */
export const MINIAPP_MAX_ACTIVE_BOOKINGS = 3;

/** Of those, booked visits ahead with one and the same doctor. */
export const MINIAPP_MAX_ACTIVE_BOOKINGS_PER_DOCTOR = 1;

/** The Tashkent days the patient may pick, today first. */
export function miniAppBookingDays(now: Date | number = Date.now()): string[] {
  const today = tashkentDateOf(now);
  return Array.from({ length: MINIAPP_BOOKING_HORIZON_DAYS }, (_, i) =>
    addTashkentDays(today, i),
  );
}

/** Whether `startAt` falls on one of `miniAppBookingDays(now)`. */
export function isWithinBookingHorizon(startAt: Date, now: Date): boolean {
  const day = tashkentDateOf(startAt);
  const today = tashkentDateOf(now);
  const last = addTashkentDays(today, MINIAPP_BOOKING_HORIZON_DAYS - 1);
  return day >= today && day <= last;
}

/**
 * The instant of a Tashkent day + slot «HH:mm» the picker offered, as ISO.
 * `new Date(y, m, d, h, min)` reads the phone's zone and moved a «10:00»
 * picked in Moscow to 12:00 at the clinic.
 */
export function tashkentSlotStartIso(dateISO: string, time: string): string {
  return new Date(`${dateISO}T${time}:00+05:00`).toISOString();
}

/**
 * A day of the strip for display: the weekday and the day of month of the
 * Tashkent date itself (noon UTC of that date, read in UTC, so no phone zone
 * can shift it to the neighbouring day).
 */
export function bookingDayLabelDate(dateISO: string): Date {
  return new Date(`${dateISO}T12:00:00Z`);
}
