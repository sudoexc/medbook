/**
 * Call sweep (audit CM-01): closes calls whose hangup never arrived.
 *
 * A PBX hangup lost on the way (network, a provider without retries) left
 * the call RINGING with no end. It then sat first in every operator's queue
 * for hours, and the call-center page auto-opened it as «the oldest call».
 *
 *   - RINGING for longer than `RINGING_STALE_MIN` → MISSED: nobody answered
 *     it, so it lands in «Пропущенные» to be called back.
 *   - ANSWERED for longer than `ANSWERED_STALE_MIN` → ENDED with no
 *     duration: the talk time is unknown, and a guess would be invented.
 *
 * Each row is closed with a guarded `updateMany` (`endedAt: null` and the
 * same status) so a hangup or an operator's «Завершить» that lands at the
 * same moment wins. Cadence: every 2 minutes; cross-clinic scan in SYSTEM.
 * Idempotent: a second pass finds nothing.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import {
  ANSWERED_STALE_MIN,
  missedUpdate,
  RINGING_STALE_MIN,
} from "@/lib/calls/call-state";
import { getQueue } from "@/server/queue";
import { publishEventSafe } from "@/server/realtime/publish";

export const QUEUE_NAME = "call-sweep";
export const JOB_NAME = "close-stale";

/** Rows per pass; a backlog drains over the next ticks. */
const BATCH = 200;

export type CallSweepResult = { missed: number; ended: number };

export async function closeStaleCalls(now: Date): Promise<CallSweepResult> {
  const ringingBefore = new Date(now.getTime() - RINGING_STALE_MIN * 60_000);
  const answeredBefore = new Date(now.getTime() - ANSWERED_STALE_MIN * 60_000);
  const out: CallSweepResult = { missed: 0, ended: 0 };

  const ringing = await prisma.call.findMany({
    where: {
      status: "RINGING",
      endedAt: null,
      OR: [
        { startedAt: { lt: ringingBefore } },
        { startedAt: null, createdAt: { lt: ringingBefore } },
      ],
    },
    select: {
      id: true,
      clinicId: true,
      direction: true,
      sipCallId: true,
      fromNumber: true,
      toNumber: true,
    },
    take: BATCH,
  });
  for (const row of ringing) {
    const res = await prisma.call.updateMany({
      where: { id: row.id, status: "RINGING", endedAt: null },
      data: missedUpdate(row, now),
    });
    if (res.count === 0) continue;
    out.missed += 1;
    publishEventSafe(row.clinicId, {
      type: "call.missed",
      payload: {
        callId: row.sipCallId ?? row.id,
        dbId: row.id,
        from: row.fromNumber,
        to: row.toNumber,
      },
    });
  }

  const answered = await prisma.call.findMany({
    where: {
      status: "ANSWERED",
      endedAt: null,
      OR: [
        { answeredAt: { lt: answeredBefore } },
        { answeredAt: null, createdAt: { lt: answeredBefore } },
      ],
    },
    select: {
      id: true,
      clinicId: true,
      sipCallId: true,
      fromNumber: true,
      toNumber: true,
    },
    take: BATCH,
  });
  for (const row of answered) {
    const res = await prisma.call.updateMany({
      where: { id: row.id, status: "ANSWERED", endedAt: null },
      data: { endedAt: now, status: "ENDED", durationSec: null },
    });
    if (res.count === 0) continue;
    out.ended += 1;
    publishEventSafe(row.clinicId, {
      type: "call.ended",
      payload: {
        callId: row.sipCallId ?? row.id,
        dbId: row.id,
        from: row.fromNumber,
        to: row.toNumber,
      },
    });
  }
  return out;
}

async function tick(): Promise<void> {
  const out = await runWithTenant({ kind: "SYSTEM" }, () =>
    closeStaleCalls(new Date()),
  );
  if (out.missed > 0 || out.ended > 0) {
    console.info(
      `[call-sweep] closed missed=${out.missed} ended=${out.ended}`,
    );
  }
}

export function startCallSweepWorker(
  intervalMs = 2 * 60_000,
): { stop: () => void } {
  const q = getQueue();
  q.registerWorker(QUEUE_NAME, JOB_NAME, tick);
  const handle = q.repeat(QUEUE_NAME, JOB_NAME, {}, intervalMs);
  console.info(`[worker] call-sweep registered every ${intervalMs}ms`);
  return handle;
}

export { tick as _tickForTests };
