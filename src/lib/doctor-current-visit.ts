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

export function pickCurrentVisit<T extends CurrentVisitCandidate>(
  appts: readonly T[],
  now: Date,
  imminentWindowMs: number = IMMINENT_WINDOW_MS,
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
    return ms >= 0 && ms <= imminentWindowMs;
  });
  if (imminent) return { row: imminent, isImplicitNext: true };

  return null;
}
