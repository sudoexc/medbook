/**
 * What undoing a cancellation or a no-show must check and put back (audit
 * AP-11).
 *
 * The doctor's «Вернуть» (`PATCH ?revert=true`, CANCELLED / NO_SHOW back to
 * a booking) only flipped the status:
 *   - the slot was not checked, so when another patient had taken the freed
 *     time the slot EXCLUDE constraint threw inside the transaction and the
 *     doctor got a 500;
 *   - a live-queue stamp left from before the cancellation (called, queued)
 *     stayed on a row that is a plain booking again, and `confirmedAt` stayed
 *     on a row written back as BOOKED;
 *   - the patient, told «приём отменён» and stripped of every queued
 *     reminder by the cancellation, was not told anything: the visit came
 *     back behind his back and became a no-show.
 *
 * Decided here as well: a visit the PATIENT cancelled himself (Mini App) is
 * not revived by the doctor. That was the patient's decision; bringing the
 * visit back is a new booking made with him, not an undo.
 */
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";

/** The reverts that put a visit back on the calendar. */
export function revivesBooking(from: string): boolean {
  return from === "CANCELLED" || from === "NO_SHOW";
}

/**
 * The status the visit had before it was dropped, as far as the row can
 * tell: a visit the patient had confirmed comes back confirmed (the reminder
 * that asks to confirm is then skipped, as for any confirmed visit), the
 * rest as a booking.
 */
export function restoredStatusOf(row: {
  confirmedAt: Date | null;
}): "BOOKED" | "CONFIRMED" {
  return row.confirmedAt ? "CONFIRMED" : "BOOKED";
}

/**
 * Live-queue stamps a revived booking must not carry: it has not been called
 * and is not in the queue. The ticket (`ticketSeq` / `queueOrder`) stays
 * frozen like on every un-arrive, and `arrivedAt` stays: it is what the
 * patient reported himself (a Mini App check-in), still true.
 */
export const REVIVED_BOOKING_RESET = {
  calledAt: null,
  queuedAt: null,
} as const;

/** The conflicts that make a revived slot impossible: someone else holds it. */
export function isSlotClash(reason: string): boolean {
  return reason === "doctor_busy" || reason === "cabinet_busy";
}

/**
 * Whether the cancellation was the patient's own (the Mini App's self-cancel,
 * the only surface where the patient acts alone). Read from the cancel
 * kernel's audit row, the latest one for the visit.
 */
export async function cancelledByPatient(
  appointmentId: string,
  clinicId: string,
): Promise<boolean> {
  const row = await prisma.auditLog.findFirst({
    where: {
      clinicId,
      entityType: "Appointment",
      entityId: appointmentId,
      action: AUDIT_ACTION.APPOINTMENT_CANCELLED,
    },
    orderBy: { createdAt: "desc" },
    select: { surface: true, actorRole: true },
  });
  return row?.surface === "MINIAPP" || row?.actorRole === "PATIENT";
}
