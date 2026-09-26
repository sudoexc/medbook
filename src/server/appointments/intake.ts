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
 *   - startedAt: cleared on an IN_PROGRESS put-back so a later restart
 *     re-times the visit («идёт приём N мин» must not count from the first
 *     start).
 *   - the day: only a visit on today's clinic day may join the queue (Q-05).
 *     The number comes from TODAY's counter, so «Пришёл» on tomorrow's
 *     booking burned today's ticket, stamped a false arrival and left the row
 *     WAITING for good (the no-show sweep never touches WAITING).
 *
 * Transaction semantics stay with the caller: run this inside `runQueueTx`
 * (Serializable) wherever two desks can race for the same order — the helper
 * only reads/allocates through the `tx` it is handed.
 */
import { prisma } from "@/lib/prisma";
import { isOnClinicDay } from "@/lib/appointment-transitions";
import { allocateQueueOrder } from "@/server/appointments/queue-order";

/** Either the prisma singleton or the `$transaction` callback parameter. */
export type PrismaTx =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The pre-update snapshot fields intake decisions are made from. */
export interface WaitingIntakeSnapshot {
  clinicId: string;
  doctorId: string;
  queueStatus: string;
  queueOrder: number | null;
  queuedAt: Date | null;
  /** The visit's start as it will be after the write (a move counts). */
  date: Date;
}

/**
 * Thrown when a row from another day would join today's queue. Routes check
 * the day before they open a transaction and answer 409 `not_today`; this is
 * the backstop for any path that forgets to.
 */
export class NotVisitDayError extends Error {
  readonly reason = "not_today" as const;
  constructor() {
    super("not_today");
    this.name = "NotVisitDayError";
  }
}

/** Fields to merge into the caller's `data` for its own update write. */
export interface WaitingIntakeFields {
  queueOrder?: number;
  ticketSeq?: number;
  queuedAt?: Date;
  startedAt?: null;
}

export async function applyWaitingIntake(
  tx: PrismaTx,
  before: WaitingIntakeSnapshot,
  now: Date,
  opts?: {
    /**
     * Bulk path: the caller pre-allocated a contiguous block of numbers (one
     * aggregate per doctor instead of one per row) and hands each row its
     * pair. Single-row paths omit this and let the helper allocate.
     */
    preset?: { queueOrder: number; ticketSeq: number };
  },
): Promise<WaitingIntakeFields> {
  if (!isOnClinicDay(before.date, now)) throw new NotVisitDayError();
  const out: WaitingIntakeFields = {};
  if (before.queueOrder == null) {
    const allocated =
      opts?.preset ??
      (await allocateQueueOrder(tx, {
        clinicId: before.clinicId,
        doctorId: before.doctorId,
        at: now,
      }));
    out.queueOrder = allocated.queueOrder;
    out.ticketSeq = allocated.ticketSeq;
  }
  if (before.queuedAt == null || before.queueStatus === "SKIPPED") {
    out.queuedAt = now;
  }
  if (before.queueStatus === "IN_PROGRESS") {
    out.startedAt = null;
  }
  return out;
}
