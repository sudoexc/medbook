/**
 * Which bookings the kiosk offers for check-in (audit Q-01).
 *
 * A booking is created BOOKED or CONFIRMED (PHONE/KIOSK bookings are
 * auto-confirmed), and the patient standing at the tablet is exactly the one
 * who has not been checked in yet. The lookup used to ask only for
 * WAITING/IN_PROGRESS rows, which hid every such booking: the kiosk sent her
 * to «choose a doctor», she got a second, walk-in visit, and the lifecycle
 * sweep later marked her real booking NO_SHOW.
 */

/**
 * Today: everything the patient can still check in to, rejoin (SKIPPED) or
 * reprint a ticket for (already WAITING / IN_PROGRESS).
 */
export const KIOSK_TODAY_STATUSES = [
  "BOOKED",
  "CONFIRMED",
  "WAITING",
  "IN_PROGRESS",
  "SKIPPED",
] as const;

/** Another day: only a booking the patient still has to come to. */
export const KIOSK_UPCOMING_STATUSES = ["BOOKED", "CONFIRMED"] as const;

/**
 * Statuses a kiosk check-in moves INTO the live queue. WAITING / IN_PROGRESS
 * are already there (a second tap only reprints the ticket).
 */
export const KIOSK_ENTERING_STATUSES = ["BOOKED", "CONFIRMED", "SKIPPED"] as const;

export function kioskCheckinEntersQueue(queueStatus: string): boolean {
  return (KIOSK_ENTERING_STATUSES as readonly string[]).includes(queueStatus);
}
