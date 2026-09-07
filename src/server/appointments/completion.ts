/**
 * The fields that close an appointment.
 *
 * `Appointment` carries two status columns: the doctor surface reads `status`,
 * the reception board reads `queueStatus`. Every transition is supposed to move
 * them together — the call path, `queue-status`, and the revert path all do.
 * `finalize` did not: it wrote `status: COMPLETED` alone, so a visit closed from
 * the doctor's cabinet left the front desk showing «На приёме» over an empty
 * queue, with no realtime event to correct it (the outbox only emits a queue
 * update when `queueStatus` actually changes).
 *
 * Keeping the pair in one helper means the next writer cannot forget half of it.
 */
import type { AppointmentStatus } from "@/generated/prisma/client";

/** Never shrink a visit below this — a 0-minute slot breaks the grid. */
const MIN_VISIT_MIN = 5;

export interface CompletionFields {
  status: AppointmentStatus;
  queueStatus: AppointmentStatus;
  completedAt: Date;
  endDate: Date;
  durationMin: number;
}

/**
 * Closing a visit early shrinks `endDate` to now so the freed tail becomes
 * bookable again; closing it late leaves the booked end alone.
 */
export function completionFields(args: {
  now: Date;
  /** Scheduled start of the appointment. */
  date: Date;
  /** Scheduled end of the appointment. */
  endDate: Date;
}): CompletionFields {
  const { now, date, endDate } = args;
  const minEnd = new Date(date.getTime() + MIN_VISIT_MIN * 60_000);
  const newEnd = now < minEnd ? minEnd : now < endDate ? now : endDate;
  const durationMin = Math.max(
    MIN_VISIT_MIN,
    Math.round((newEnd.getTime() - date.getTime()) / 60_000),
  );
  return {
    status: "COMPLETED",
    queueStatus: "COMPLETED",
    completedAt: now,
    endDate: newEnd,
    durationMin,
  };
}
