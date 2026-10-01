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
 * sweep leaves such a row alone (and hands reception a task when nobody
 * reacted). One rule for all of them: the patient checked in on the visit's
 * own clinic day and the desk has not yet. Pure and client-safe.
 */
import { tashkentDateOf } from "@/lib/tashkent-time";

/** Pre-arrival statuses: the desk has not marked the patient «Пришёл». */
const AWAITING_DESK: ReadonlySet<string> = new Set(["BOOKED", "CONFIRMED"]);

/**
 * Whether the visit carries a check-in made for it as it stands: tapped on
 * the visit's own clinic day (review of G3-01).
 *
 * The Mini App accepts the tap only on that day, but the stamp outlives a
 * move: a patient who tapped on 01.10 and was never met, then moved by
 * reception to 08.10, used to arrive on 08.10 already «Отметился в
 * приложении в 09:10». The desk believed he was in the hall, the sweep never
 * marked the real no-show, and his real tap on 08.10 was swallowed as a
 * repeat. Staff moves now clear the stamp (`checkInResetOnMove`); this rule
 * keeps any stamp that slipped through, or predates that, from counting.
 */
export function checkedInOnVisitDay(row: {
  arrivedAt?: string | Date | null;
  date: string | Date;
}): boolean {
  if (!row.arrivedAt) return false;
  const at = new Date(row.arrivedAt);
  const visit = new Date(row.date);
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(visit.getTime())) {
    return false;
  }
  return tashkentDateOf(at) === tashkentDateOf(visit);
}

/**
 * The extra column a staff move writes: a visit moved to another clinic day
 * drops its check-in, which was made for the old day (see
 * `checkedInOnVisitDay`). A move within the day keeps it: the patient is
 * still in the building. Spread into the update's `data`.
 */
export function checkInResetOnMove(
  from: Date,
  to: Date,
): { arrivedAt: null } | Record<string, never> {
  return tashkentDateOf(from) === tashkentDateOf(to) ? {} : { arrivedAt: null };
}

/**
 * True while the patient has checked in from the Mini App for this visit and
 * the desk has not marked him arrived. Reads the queue column first:
 * reception's lanes go by `queueStatus`.
 */
export function awaitsDeskCheckIn(row: {
  arrivedAt?: string | Date | null;
  date: string | Date;
  status: string;
  queueStatus?: string | null;
}): boolean {
  if (!checkedInOnVisitDay(row)) return false;
  return AWAITING_DESK.has(row.queueStatus ?? row.status);
}

/**
 * The statuses after which the desk has reacted (or the visit is over), so
 * the self check-in alert for it can go.
 */
export function deskHasReacted(status: string | null | undefined): boolean {
  return !!status && !AWAITING_DESK.has(status);
}
