/**
 * Which appointment statuses the doctor surface treats as "still ahead" or
 * "under way" (audit DC-05).
 *
 * Phone and kiosk bookings are created CONFIRMED (AUTO_CONFIRM_CHANNELS in
 * `server/appointments/book.ts`), so on this clinic CONFIRMED is the normal
 * pre-visit state, not a rare one. Every doctor endpoint used to spell its
 * own list by hand (`["BOOKED", "WAITING"]` and similar), and each list
 * dropped CONFIRMED: a patient booked by phone for 15:00 was missing from
 * «Сегодняшние», read «Следующий приём: —», and the «Мой день» badge counted
 * fewer patients than the day really had. One list, imported everywhere,
 * so the next status added to the lifecycle is added once.
 *
 * Client-safe: no server imports.
 */
import type { AppointmentStatus } from "@/lib/appointment-transitions";

/**
 * The patient is expected but not seen yet: booked, confirmed on the phone,
 * or already sitting in the waiting room. SKIPPED is left out on purpose:
 * the doctor surface files it with the finished visits
 * (`scheduleStatusOf`), and reception brings the patient back as WAITING.
 */
export const UPCOMING_VISIT_STATUSES = [
  "BOOKED",
  "CONFIRMED",
  "WAITING",
] as const satisfies readonly AppointmentStatus[];

/** Upcoming plus the visit on the table: everything that still needs the doctor. */
export const ACTIVE_VISIT_STATUSES = [
  ...UPCOMING_VISIT_STATUSES,
  "IN_PROGRESS",
] as const satisfies readonly AppointmentStatus[];

/**
 * A patient "of today" for the doctor: still to come, on the table, or
 * already seen. Cancelled visits and no-shows are not.
 */
export const TODAY_VISIT_STATUSES = [
  ...ACTIVE_VISIT_STATUSES,
  "COMPLETED",
] as const satisfies readonly AppointmentStatus[];

const UPCOMING_SET: ReadonlySet<string> = new Set(UPCOMING_VISIT_STATUSES);
const ACTIVE_SET: ReadonlySet<string> = new Set(ACTIVE_VISIT_STATUSES);

export function isUpcomingVisitStatus(status: string): boolean {
  return UPCOMING_SET.has(status);
}

export function isActiveVisitStatus(status: string): boolean {
  return ACTIVE_SET.has(status);
}
