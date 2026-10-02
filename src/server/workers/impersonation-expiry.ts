/**
 * Audit G5-09 — closes SUPER_ADMIN clinic visits whose 60 minute lease ran
 * out without «Выйти».
 *
 * The grant cookies expire with the lease, so no request ever shows up with
 * an expired grant to stamp: before this sweep such grants stayed open
 * forever and the journal had SUPER_ADMIN_IMPERSONATE_STARTED with no end.
 * Every minute `expireLapsedGrants` stamps each lapsed grant
 * `endedReason="expired"` (endedAt = the lease end) and writes
 * SUPER_ADMIN_IMPERSONATE_EXPIRED with the grant's clinic. Idempotent: each
 * close is conditional on the grant still being open.
 */
import { getQueue } from "@/server/queue";
import { expireLapsedGrants } from "@/server/platform/impersonation";

export const QUEUE_NAME = "impersonation-expiry";
export const JOB_NAME = "sweep";

async function tick(): Promise<void> {
  const closed = await expireLapsedGrants(new Date());
  if (closed > 0) {
    console.info(`[impersonation-expiry] closed ${closed} lapsed grant(s)`);
  }
}

export function startImpersonationExpiryWorker(
  intervalMs = 60_000,
): { stop: () => void } {
  const q = getQueue();
  q.registerWorker(QUEUE_NAME, JOB_NAME, tick);
  const handle = q.repeat(QUEUE_NAME, JOB_NAME, {}, intervalMs);
  console.info(`[worker] impersonation-expiry registered every ${intervalMs}ms`);
  return handle;
}

export { tick as _tickForTests };
