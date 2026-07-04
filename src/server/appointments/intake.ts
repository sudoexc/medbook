/**
 * Shared WAITING-intake side-effects («Пришёл» / kiosk check-in semantics).
 *
 * Flipping a row into WAITING is more than a status write: the row must claim
 * a live-queue slot exactly once and stamp its FIFO anchor. Three routes flip
 * rows to WAITING (queue-status PATCH, the generic appointment PATCH, and
 * bulk-status) — before this module only queue-status ran the allocation, so
 * the other two paths joined the queue with a null order the board could not
 * ticket. The rules, in one place:
 *
 *   - queueOrder/ticketSeq: allocated once (a BOOKED/CONFIRMED row carries
 *     none), then frozen forever — a returning SKIPPED row keeps its numbers
 *     so the printed ticket never churns (two-lanes I5).
 *   - queuedAt: stamped on first arrival (null) or when a SKIPPED patient
 *     comes back (they re-join at the back of the FIFO). An IN_PROGRESS
 *     put-back keeps its original stamp so it doesn't surrender its place.
 *
 * Transaction semantics stay with the caller: run this inside `runQueueTx`
 * (Serializable) wherever two desks can race for the same order — the helper
 * only reads/allocates through the `tx` it is handed.
 */
import { prisma } from "@/lib/prisma";
import { allocateQueueOrder } from "@/server/appointments/queue-order";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The pre-update snapshot fields intake decisions are made from. */
export interface WaitingIntakeSnapshot {
  clinicId: string;
  doctorId: string;
  queueStatus: string;
  queueOrder: number | null;
  queuedAt: Date | null;
}

/** Fields to merge into the caller's `data` for its own update write. */
export interface WaitingIntakeFields {
  queueOrder?: number;
  ticketSeq?: number;
  queuedAt?: Date;
}

export async function applyWaitingIntake(
  tx: PrismaLike,
  before: WaitingIntakeSnapshot,
  now: Date,
): Promise<WaitingIntakeFields> {
  const out: WaitingIntakeFields = {};
  if (before.queueOrder == null) {
    const order = await allocateQueueOrder(tx, {
      clinicId: before.clinicId,
      doctorId: before.doctorId,
      at: now,
    });
    out.queueOrder = order;
    out.ticketSeq = order;
  }
  if (before.queuedAt == null || before.queueStatus === "SKIPPED") {
    out.queuedAt = now;
  }
  return out;
}
