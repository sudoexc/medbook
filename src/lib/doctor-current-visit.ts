/**
 * Who belongs on the doctor's «Текущий пациент» hero card.
 *
 * Extracted from `/api/crm/doctors/me/today` because the naive version —
 * `appts.find(a => a.status === "IN_PROGRESS" || a.status === "WAITING")` over
 * a date-ASC list — let any earlier-dated WAITING row shadow the visit that
 * was actually underway. Walk-ins are stamped `date = now` at registration
 * (server/appointments/walkin.ts), so in a clinic with a live queue this fired
 * daily: the hero card showed a queued patient with «Начать приём», and
 * pressing it force-completed the real visit via the switch-confirm dialog.
 *
 * The precedence below is the spec; see doctor-current-visit.test.ts for the
 * invariants it must keep.
 */
import { isLiveLane } from "@/lib/queue-ordering";

export type CurrentVisitCandidate = {
  status: string;
  calledAt: Date | null;
  channel: string;
  date: Date;
};

export type CurrentVisitPick<T> = {
  row: T;
  /**
   * True when the pick is the "next booking starts soon" courtesy fallback
   * rather than a visit the doctor actually started — the card labels itself
   * «Следующая запись» instead of implying someone is on the table.
   */
  isImplicitNext: boolean;
};

/** How far ahead a booking may be and still occupy the hero card. */
export const IMMINENT_WINDOW_MS = 15 * 60_000;

/**
 * How long a booking keeps the hero card after its scheduled start. A patient
 * running 5-10 minutes late is routine, and the old `ms >= 0` cutoff dropped
 * the card (and its «Начать» CTA) the very second the slot began — exactly
 * when the doctor needed it. The row leaves the card early only through an
 * explicit action: CANCELLED / NO_SHOW (status filter below), or another
 * visit being started/called (higher-precedence branches above).
 */
export const LATE_ARRIVAL_GRACE_MS = 30 * 60_000;

export function pickCurrentVisit<T extends CurrentVisitCandidate>(
  appts: readonly T[],
  now: Date,
  imminentWindowMs: number = IMMINENT_WINDOW_MS,
  lateArrivalGraceMs: number = LATE_ARRIVAL_GRACE_MS,
): CurrentVisitPick<T> | null {
  // 1. The running visit wins, whichever lane it came from — a walk-in called
  //    into the room is every bit the current patient as a booked one.
  const running = appts.find((a) => a.status === "IN_PROGRESS");
  if (running) return { row: running, isImplicitNext: false };

  // 2. Nobody started yet, but the doctor pressed «Вызвать»: that patient is
  //    walking to the room, so they hold the card (CTA «Начать приём»). An
  //    un-called WAITING row is merely queued — it belongs to the live queue
  //    or the schedule, never to the hero card.
  const called = appts.find(
    (a) => a.status === "WAITING" && a.calledAt !== null,
  );
  if (called) return { row: called, isImplicitNext: false };

  // 3. Courtesy fallback: the next booking due within the window. Bookings
  //    only — a walk-in has no meaningful "starts at", and surfacing one here
  //    would resurrect the shadowing bug through the back door.
  const imminent = appts.find((a) => {
    if (isLiveLane(a)) return false;
    // CRM bookings auto-confirm, so CONFIRMED is the default pre-visit state;
    // without it the doctor never sees the imminent-patient card.
    if (a.status !== "BOOKED" && a.status !== "CONFIRMED") return false;
    const ms = a.date.getTime() - now.getTime();
    // Negative ms = the slot already started. Keep the card up through the
    // late-arrival grace so a slightly-late patient can still be started in
    // one click; `find` over the date-ASC list means the earliest still-
    // eligible booking (the most overdue one) wins over a future imminent one.
    return ms >= -lateArrivalGraceMs && ms <= imminentWindowMs;
  });
  if (imminent) return { row: imminent, isImplicitNext: true };

  return null;
}
