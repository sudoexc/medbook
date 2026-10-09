/**
 * Setting a doctor's live queue by hand from the reception tablet (owner
 * request 08.10.2026): the receptionist walks up to a crowd and calls the
 * order out herself, «ты первая, ты вторая, ты третья». She taps the people
 * in that order; one reorder call (POST /api/crm/appointments/reorder) then
 * persists it, so the tablet, the desk and the doctor's TV agree.
 *
 * Pure: the queue screen and the unit tests share it.
 */
import { compareQueue, isLiveLane, isLiveWaiting } from "@/lib/queue-ordering";

import type { TabletApptRow } from "./doctor-day";

/** A doctor's live queue (waiting walk-ins), next first: what the reorder API takes. */
export function liveQueueOf(
  rows: ReadonlyArray<TabletApptRow>,
  doctorId: string,
): TabletApptRow[] {
  return rows
    .filter((r) => r.doctor.id === doctorId && isLiveWaiting(r))
    .slice()
    .sort(compareQueue);
}

/** Bookings of a doctor whose patient has come and waits: reprint only. */
export function arrivedBookingsOf(
  rows: ReadonlyArray<TabletApptRow>,
  doctorId: string,
): TabletApptRow[] {
  return rows
    .filter(
      (r) => r.doctor.id === doctorId && !isLiveLane(r) && (r.queueStatus ?? r.status) === "WAITING",
    )
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * The order to save: the people she tapped, in the order she tapped them,
 * then everyone she did not tap, in their current order. Taps for rows that
 * have left the queue meanwhile are dropped; someone who joined while she
 * was tapping lands after the tapped ones.
 */
export function tapOrderToIds(
  current: ReadonlyArray<string>,
  tapped: ReadonlyArray<string>,
): string[] {
  const present = new Set(current);
  const first = tapped.filter((id, i) => present.has(id) && tapped.indexOf(id) === i);
  const taken = new Set(first);
  return [...first, ...current.filter((id) => !taken.has(id))];
}

/** A tap: adds the row at the end of the called order, or takes it back out. */
export function toggleTap(tapped: ReadonlyArray<string>, id: string): string[] {
  return tapped.includes(id) ? tapped.filter((t) => t !== id) : [...tapped, id];
}

/** One place up (-1) or down (+1); null when it is already at that end. */
export function moveId(
  current: ReadonlyArray<string>,
  id: string,
  delta: -1 | 1,
): string[] | null {
  const i = current.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= current.length) return null;
  const next = current.slice();
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
