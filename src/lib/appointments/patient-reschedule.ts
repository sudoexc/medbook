/**
 * Whether the patient has already arrived for a visit, so the Mini App may no
 * longer move it (review of audit MA-20).
 *
 * The Mini App reschedule rewrites date, time and end and leaves every queue
 * column alone. That is right for a plain booking and wrong once the patient
 * is in the building:
 *   - a walk-in (registerWalkin: WAITING, ticket allocated, date = now) moved
 *     to tomorrow drops off today's reception queue and TV board, which only
 *     read today's rows, while the patient may still be sitting in the hall;
 *     tomorrow the row already counts as arrived and queued before he comes;
 *   - a SKIPPED row moved forward stays «Пропущен» on a day it never reached;
 *   - a self check-in («Я на месте», arrivedAt) moved to tomorrow shows
 *     «вы отметились» there, and tomorrow's tap no longer reaches the desk.
 *
 * MA-20 files live-queue visits under «Предстоящие», where patients actually
 * look, so the route refuses the move and the sheet hides «Перенести»: once
 * the patient has arrived, reception moves the visit. Cancelling stays open.
 *
 * Client-safe: no server imports.
 */
import type { AppointmentStatus } from "@/lib/appointment-transitions";

/**
 * Lifecycle (or queue) states a visit only reaches after arrival. IN_PROGRESS
 * is listed for the queue column; the status itself is refused earlier as
 * not editable at all.
 */
const ARRIVED_STATUSES: ReadonlySet<string> = new Set<AppointmentStatus>([
  "WAITING",
  "IN_PROGRESS",
  "SKIPPED",
]);

export interface ArrivalSnapshot {
  status: string;
  /** Absent on the patient-safe client shape, which carries `status` only. */
  queueStatus?: string | null;
  arrivedAt?: Date | string | null;
}

/** True once the patient joined the live flow or tapped «Я на месте». */
export function hasArrivedForVisit(row: ArrivalSnapshot): boolean {
  if (ARRIVED_STATUSES.has(row.status)) return true;
  if (row.queueStatus && ARRIVED_STATUSES.has(row.queueStatus)) return true;
  return row.arrivedAt != null;
}
