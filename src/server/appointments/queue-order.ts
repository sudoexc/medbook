/**
 * Live-queue order allocation for walk-in / kiosk check-in.
 *
 * `queueOrder` is a 1-based, per-doctor-per-day counter that drives the
 * waiting-room board and paper-ticket number. Two clients (kiosk + reception,
 * or two kiosk taps) can race: the old "aggregate max, then write max+1" as
 * two separate statements lets both read the same max and hand out a
 * duplicate order. `allocateQueueOrder` is meant to run *inside* a
 * Serializable transaction (`runQueueTx`) so Postgres aborts the loser and
 * `withWriteConflictRetry` re-runs it instead of corrupting the sequence.
 */
import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Statuses that own a queueOrder slot for the day. COMPLETED stays counted so
 * a finished visit's number is never re-issued to the next walk-in.
 */
export const QUEUE_OCCUPYING_STATUSES = [
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
] as const;

/**
 * Next queueOrder for a doctor's live queue *today* (Tashkent wall-clock day,
 * not server-local/UTC — see `tashkentDayBounds`). Run inside `runQueueTx`.
 */
export async function allocateQueueOrder(
  tx: PrismaLike,
  args: { clinicId: string; doctorId: string; at?: Date },
): Promise<number> {
  const { dayStart, dayEnd } = tashkentDayBounds(args.at);
  const max = await tx.appointment.aggregate({
    where: {
      clinicId: args.clinicId,
      doctorId: args.doctorId,
      date: { gte: dayStart, lt: dayEnd },
      queueStatus: { in: [...QUEUE_OCCUPYING_STATUSES] },
    },
    _max: { queueOrder: true },
  });
  return (max._max.queueOrder ?? 0) + 1;
}

/**
 * Run a queue write under Serializable isolation, retrying on Postgres
 * write-conflict (40001 / P2034). Without this a concurrent allocation
 * surfaces as a 500; with it the loser quietly re-reads the new max.
 */
export async function runQueueTx<T>(
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: "Serializable" });
    } catch (e) {
      if (!isWriteConflict(e)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

function isWriteConflict(e: unknown): boolean {
  const x = e as {
    code?: string;
    originalCode?: string;
    kind?: string;
    name?: string;
    message?: string;
  } | null;
  const msg = x?.message ?? "";
  return (
    x?.code === "P2034" ||
    x?.code === "40001" ||
    x?.originalCode === "40001" ||
    x?.kind === "TransactionWriteConflict" ||
    msg.includes("could not serialize access") ||
    msg.includes("write conflict or a deadlock")
  );
}
