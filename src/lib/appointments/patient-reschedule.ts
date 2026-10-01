/**
 * What the patient may still do with a visit from the Mini App: move it
 * (review of audit MA-20, MA-17) or cancel it (MA-15). The route and the
 * sheet read the same rules.
 *
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

/**
 * What a patient may cancel from the Mini App (audit MA-15): a visit that
 * has not reached the doctor. A queued or skipped patient may still leave
 * (the desk then stops waiting for him), but a visit on the table is the
 * doctor's: cancelling it dropped the current patient from his queue and
 * left the started exam on a cancelled row. Finished visits are history.
 * The list in the sheet (✕) reads the same set, so a stale cache can only
 * show a button the server then refuses, never the other way round.
 */
export const PATIENT_CANCELLABLE_STATUSES = [
  "BOOKED",
  "CONFIRMED",
  "WAITING",
  "SKIPPED",
] as const satisfies readonly AppointmentStatus[];

const PATIENT_CANCELLABLE: ReadonlySet<string> = new Set(PATIENT_CANCELLABLE_STATUSES);

export function isPatientCancellable(status: string): boolean {
  return PATIENT_CANCELLABLE.has(status);
}

/** Booked visits the patient may still move himself (audit MA-17). */
const PATIENT_RESCHEDULABLE: ReadonlySet<string> = new Set<AppointmentStatus>([
  "BOOKED",
  "CONFIRMED",
]);

/**
 * Why the patient may not move this visit himself, or null when he may.
 *
 *   - `not_editable`: the visit is over, cancelled, missed or on the table;
 *     there is nothing left to move.
 *   - `not_reschedulable`: the patient is in the live flow (a walk-in
 *     ticket, queued, skipped, «Я на месте»). Its queue columns would travel
 *     to the new day, so reception moves it.
 *
 * A live-queue row (channel WALKIN) is refused even if reception put it back
 * to BOOKED: it holds no slot, and moving it would put a ticket of today's
 * queue onto another day's schedule.
 */
export function patientRescheduleRefusal(
  row: ArrivalSnapshot & { channel?: string | null },
): "not_editable" | "not_reschedulable" | null {
  if (row.status === "WAITING" || row.status === "SKIPPED") return "not_reschedulable";
  if (!PATIENT_RESCHEDULABLE.has(row.status)) return "not_editable";
  if (hasArrivedForVisit(row)) return "not_reschedulable";
  if (row.channel === "WALKIN") return "not_reschedulable";
  return null;
}
