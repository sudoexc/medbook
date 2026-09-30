/**
 * staff-messages-send worker (audit TG-17).
 *
 *   conversations:send / deliver   one staff chat message, `{ messageId }`,
 *                                  enqueued by POST .../messages and by
 *                                  «Повторить». Claims QUEUED→SENDING, sends,
 *                                  records SENT / FAILED.
 *   conversations:send / sweep     every 20s: re-queue a message whose job was
 *                                  lost, close one that waited too long.
 *
 * One queue, so BullMQ runs these one at a time: messages of a thread leave
 * in the order they were written.
 */
import { getQueue } from "@/server/queue";
import {
  STAFF_SEND_JOB,
  STAFF_SEND_QUEUE,
  STAFF_SWEEP_JOB,
  deliverStaffMessage,
  sweepStaffMessages,
  type StaffSendJob,
} from "@/server/conversations/staff-dispatch";

const SWEEP_INTERVAL_MS = 20_000;

export function startStaffMessagesSendWorker(
  intervalMs: number = SWEEP_INTERVAL_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<StaffSendJob>(STAFF_SEND_QUEUE, STAFF_SEND_JOB, async (job) => {
    await deliverStaffMessage(job);
  });
  queue.registerWorker<Record<string, never>>(
    STAFF_SEND_QUEUE,
    STAFF_SWEEP_JOB,
    async () => {
      try {
        const r = await sweepStaffMessages();
        if (r.requeued || r.expired || r.stuck) {
          console.info(
            `[worker] staff-messages sweep requeued=${r.requeued} expired=${r.expired} stuck=${r.stuck}`,
          );
        }
      } catch (err) {
        console.error("[worker] staff-messages sweep failed", err);
      }
    },
  );
  const handle = queue.repeat(
    STAFF_SEND_QUEUE,
    STAFF_SWEEP_JOB,
    {} as never,
    intervalMs,
  );
  console.info("[worker] staff-messages-send registered");
  return handle;
}
