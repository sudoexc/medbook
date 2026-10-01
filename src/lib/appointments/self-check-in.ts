/**
 * «Я на месте» from the Mini App, as reception must see it (audit G3-01).
 *
 * The check-in stamps `Appointment.arrivedAt` and nothing else: the visit
 * stays a booking until a person presses «Пришёл» (WAITING), because only the
 * desk can put a patient in the doctor's queue. The only trace of it used to
 * be a four-second toast on the reception page. The patient sat in the hall
 * («вас встретят»), the desk was on another page, and an hour after the slot
 * the sweep marked him a no-show and texted him so.
 *
 * Now the booking carries a badge on every reception list until «Пришёл»,
 * the desk gets an alert that stays until dismissed on any CRM page, and the
 * sweep leaves such a row alone. One rule for all of them: the patient
 * checked in and the desk has not yet. Pure and client-safe.
 */

/** Pre-arrival statuses: the desk has not marked the patient «Пришёл». */
const AWAITING_DESK: ReadonlySet<string> = new Set(["BOOKED", "CONFIRMED"]);

/**
 * True while the patient has checked in from the Mini App and the desk has
 * not marked him arrived. Reads the queue column first: reception's lanes go
 * by `queueStatus`.
 */
export function awaitsDeskCheckIn(row: {
  arrivedAt?: string | Date | null;
  status: string;
  queueStatus?: string | null;
}): boolean {
  if (!row.arrivedAt) return false;
  return AWAITING_DESK.has(row.queueStatus ?? row.status);
}

/**
 * The statuses after which the desk has reacted (or the visit is over), so
 * the self check-in alert for it can go.
 */
export function deskHasReacted(status: string | null | undefined): boolean {
  return !!status && !AWAITING_DESK.has(status);
}
