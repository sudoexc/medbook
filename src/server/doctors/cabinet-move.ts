/**
 * A doctor moves to another cabinet: his visits that are still ahead move
 * with him (audit DR-11).
 *
 * Every appointment snapshots `cabinetId` when it is created (book.ts,
 * walkin.ts), and the reminders, the reception queue, the ticket and the TV
 * board all read that snapshot. Changing `Doctor.cabinetId` alone left the
 * next weeks of visits pointing at the old room: patients were told «ждём
 * вас в кабинете 101» after the doctor moved to 205, and the colleague who
 * took over 101 got false «кабинет занят» conflicts from those rows (the
 * cabinet overlap check and the EXCLUDE constraint key on the snapshot).
 *
 * Runs inside the doctor PATCH transaction, so the doctor row and his visits
 * never disagree. A visit in the new room that would overlap one of them
 * makes the constraint refuse the whole move (the route answers 409).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/prisma";
import { ACTIVE_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import { tashkentDateOf, tashkentDayWindow } from "@/lib/tashkent-time";

type TxLike = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Visits that are not over yet: expected, waiting, on the table, or skipped
 * (reception brings a skipped patient back into the same queue). Finished,
 * cancelled and no-show visits keep the room they actually happened in.
 */
export const CABINET_FOLLOWS_STATUSES = [
  ...ACTIVE_VISIT_STATUSES,
  "SKIPPED",
] as const;

/**
 * From the start of today on the clinic's wall clock: this morning's queue
 * moves too, yesterday's history does not. Rows with no cabinet (a
 * telemedicine visit) are left without one.
 */
export function cabinetMoveWhere(
  doctorId: string,
  newCabinetId: string,
  now: Date = new Date(),
): Prisma.AppointmentWhereInput {
  return {
    doctorId,
    date: { gte: tashkentDayWindow(tashkentDateOf(now)).from },
    status: { in: [...CABINET_FOLLOWS_STATUSES] },
    AND: [{ cabinetId: { not: null } }, { cabinetId: { not: newCabinetId } }],
  };
}

/** Re-point the doctor's remaining visits at his new cabinet; returns how many moved. */
export async function moveFutureAppointmentsToCabinet(
  tx: TxLike,
  args: { doctorId: string; cabinetId: string; now?: Date },
): Promise<number> {
  const res = await tx.appointment.updateMany({
    where: cabinetMoveWhere(args.doctorId, args.cabinetId, args.now),
    data: { cabinetId: args.cabinetId },
  });
  return res.count;
}
