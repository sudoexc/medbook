/**
 * notifications-scheduler — cron-style poller.
 *
 * Every minute:
 *   1. Run trigger materialisation (birthday, 24h/2h reminders, payment.due).
 *   2. Pick QUEUED NotificationSend rows whose `scheduledFor <= now()` and
 *      enqueue them on `notifications:send`.
 *
 * The scheduler does NOT send anything itself — it's a dispatcher. The
 * actual delivery + retry lives in `notifications-send.ts`.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { runScheduledTriggers } from "@/server/notifications/triggers";
import { enqueue, getQueue } from "@/server/queue";

import {
  JOB_NAME as SEND_JOB,
  QUEUE_NAME as SEND_QUEUE,
} from "./notifications-send";

export const QUEUE_NAME = "notifications:scheduler";
export const JOB_NAME = "tick";

export type TickResult = {
  triggered: Awaited<ReturnType<typeof runScheduledTriggers>>;
  dispatched: number;
};

async function tick(): Promise<void> {
  const triggered = await runScheduledTriggers();

  const now = new Date();
  const due = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.findMany({
      where: { status: "QUEUED", scheduledFor: { lte: now } },
      select: { id: true },
      take: 500,
    }),
  );
  for (const s of due) {
    await enqueue(SEND_QUEUE, SEND_JOB, { sendId: s.id });
  }

  console.info(
    `[scheduler] tick ok triggered=${JSON.stringify(triggered)} dispatched=${due.length}`,
  );
}

export function startNotificationsSchedulerWorker(
  intervalMs = 60_000,
): { stop: () => void } {
  const q = getQueue();
  q.registerWorker(QUEUE_NAME, JOB_NAME, tick);
  const handle = q.repeat(QUEUE_NAME, JOB_NAME, {}, intervalMs);
  console.info(`[worker] notifications-scheduler registered every ${intervalMs}ms`);
  return handle;
}

export { tick as _tickForTests };
