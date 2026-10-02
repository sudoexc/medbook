/**
 * OutboxPumper — drains `EventOutbox` to the realtime bus.
 *
 * TZ §5.2. Phase A.5.
 *
 * Loop (every `intervalMs`, default 200ms):
 *
 *   1. SELECT a small batch of `PENDING` rows (delivered at once on the first
 *      attempt) and `FAILED` rows whose retry window has elapsed
 *      (`createdAt + 2^attempts * 1s < now()`), ordered by `createdAt`.
 *      Each row is locked with `FOR UPDATE SKIP LOCKED` so multiple pumpers
 *      can run in parallel without double-delivery.
 *   2. For each row:
 *        a. Parse `envelope` with `EventEnvelopeSchema`.
 *        b. Call `publishEvent(clinicId, …)` — local bus + Redis fan-out.
 *        c. If the event is `auditable`, upsert an `AuditLog` row keyed on
 *           `eventId` (UNIQUE). Re-delivery never duplicates audit rows.
 *        d. Update `status='DELIVERED'`, `deliveredAt=now()`.
 *   3. On failure:
 *        - `attempts < MAX_ATTEMPTS` → `status='FAILED'`, retry next eligible.
 *        - `attempts >= MAX_ATTEMPTS` → `status='DEAD'`, leave for manual triage.
 *
 * Idempotency:
 *
 *   - `AuditLog.eventId` is UNIQUE — duplicate audit inserts are caught and
 *     swallowed, so the worker can retry a partially-delivered row safely.
 *   - SSE fan-out (publishEvent) is best-effort; a duplicate broadcast just
 *     causes a duplicate UI refetch on the rare reconnect-overlap.
 *
 * Backpressure: the batch size + interval gives an upper bound of
 * `BATCH_SIZE * (1000 / intervalMs)` events/sec per pumper. When the PENDING
 * backlog grows past a threshold we surface an action-center alert (Phase G);
 * for Phase A we log a warning if the per-tick batch is fully saturated.
 * `/api/health` reports the age of the oldest undelivered row (audit INF-01).
 *
 * Redis down (audit INF-17): the pumper runs in the worker, where no SSE
 * client listens, so Redis is the only road to the screens. A failed PUBLISH
 * used to be swallowed and the row marked DELIVERED. Now the row is left
 * FAILED for the next tick, its attempts untouched (an outage is not the
 * event's fault and must not dead-letter it), and the rest of the batch
 * waits too, so events still go out in order once Redis is back. Health
 * shows the backlog as an outbox row pending for over a minute.
 *
 * Retention (audit INF-04): delivered rows only serve the SSE replay of a
 * reconnecting client, which looks back minutes, and they carry patient data
 * in the envelope. An hourly sweep deletes DELIVERED rows after 7 days and
 * DEAD rows after 30 (time enough to triage them); the table no longer grows
 * without bound under the 200 ms poll.
 */

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import type { prisma as prismaT } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { recordHeartbeat } from "@/server/observability/worker-heartbeat";
import { getQueue } from "@/server/queue";

import {
  EventEnvelopeSchema,
  getEventMeta,
  type EventEnvelope,
} from "@/server/realtime/envelope";
import { broadcastEnvelope } from "@/server/realtime/publish";
import { RedisPublishError } from "@/server/realtime/redis-adapter";

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;
const DEFAULT_INTERVAL_MS = 200;
// The batch's broadcasts and audit writes run inside the locking transaction.
// Prisma's default 5 s timeout expired on a slow Redis: the rows rolled back
// to PENDING and were broadcast again on the next tick (audit INF-04).
const TX_TIMEOUT_MS = 30_000;

export const RETENTION_QUEUE = "outbox:retention";
export const RETENTION_JOB = "prune";
const RETENTION_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Delivered rows feed only the SSE replay, which looks back minutes. */
export const DELIVERED_RETENTION_MS = 7 * DAY_MS;
/** Dead letters stay long enough for someone to look at them. */
export const DEAD_RETENTION_MS = 30 * DAY_MS;
/** Rows per DELETE, so a first sweep over a large backlog never holds long locks. */
const PRUNE_BATCH = 5_000;
/** At most one "Redis down" line per this window: the pumper ticks at 200 ms. */
const REDIS_WARN_EVERY_MS = 30_000;
let lastRedisWarnAt = 0;

type OutboxRow = {
  id: string;
  envelope: Prisma.JsonValue;
  attempts: number;
};

/**
 * Pick eligible PENDING rows + lock them. Raw SQL because Prisma doesn't
 * expose `FOR UPDATE SKIP LOCKED`. The retry-window predicate uses Postgres
 * interval arithmetic so the worker doesn't need to compute it in JS.
 *
 * A row on its first attempt is due at once: the window `1 << 0` = 1 s held
 * every live event (a confirmation, «пришёл», a signed visit) back at least
 * a second (audit INF-04). The row is only visible after its transaction
 * committed, so there is nothing to wait for. The backoff applies to retries.
 * `(status, createdAt)` serves the scan; it used to read the whole table
 * because every index started with `clinicId`.
 */
// Same narrowing trick as `mintReferralRewardOnCompletion` — the extended
// client's transaction callback parameter is a *subset* of the singleton
// (no `$extends`, `$use`), so we accept it loosely and rely on the runtime
// shape. The structural mismatch is harmless for `$queryRaw`.
type Tx = Parameters<Parameters<typeof prismaT["$transaction"]>[0]>[0];

async function lockBatch(tx: Tx): Promise<OutboxRow[]> {
  return tx.$queryRaw<OutboxRow[]>`
    SELECT id, envelope, attempts
    FROM "EventOutbox"
    WHERE status IN ('PENDING', 'FAILED')
      AND (
        attempts = 0
        OR ("createdAt" + ((1 << attempts) * INTERVAL '1 second')) <= NOW()
      )
    ORDER BY "createdAt"
    LIMIT ${BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  `;
}

/**
 * Materialise an `AuditLog` row from an envelope. Idempotent via the UNIQUE
 * index on `AuditLog.eventId` — `createMany({ skipDuplicates: true })` will
 * no-op a re-delivery. The action string is derived from the event type so
 * compliance dashboards keep a stable taxonomy.
 */
async function writeAuditLog(envelope: EventEnvelope): Promise<void> {
  await prisma.auditLog.createMany({
    skipDuplicates: true,
    data: [
      {
        eventId: envelope.eventId,
        clinicId: envelope.tenantScope.clinicId,
        actorId: envelope.actor.userId,
        actorRole: envelope.actor.role,
        actorLabel: envelope.actor.label,
        action: `event:${envelope.type}`,
        entityType: envelope.tenantScope.appointmentId
          ? "Appointment"
          : envelope.tenantScope.patientId
            ? "Patient"
            : envelope.tenantScope.doctorId
              ? "Doctor"
              : "Clinic",
        entityId:
          envelope.tenantScope.appointmentId ??
          envelope.tenantScope.patientId ??
          envelope.tenantScope.doctorId ??
          envelope.tenantScope.clinicId,
        meta: envelope as unknown as Prisma.InputJsonValue,
        surface: envelope.surface,
        correlationId: envelope.correlationId,
      },
    ],
  });
}

async function deliverOne(row: OutboxRow): Promise<void> {
  const parsed = EventEnvelopeSchema.safeParse(row.envelope);
  if (!parsed.success) {
    // Bad envelope — bump attempts, eventually DEAD-letter. Caller wraps.
    throw new Error(
      `envelope parse failed: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  const envelope = parsed.data as EventEnvelope;

  // Fan out the full v2 envelope to local bus + Redis. SSE handlers read
  // `eventId` off the envelope to emit `id:` lines for Last-Event-ID replay.
  await broadcastEnvelope(envelope);

  const meta = getEventMeta(envelope.type);
  if (meta.auditable) {
    await writeAuditLog(envelope);
  }
}

/** One pumper tick. Exported for tests. */
export async function pumpOnce(): Promise<{
  delivered: number;
  failed: number;
  dead: number;
}> {
  let delivered = 0;
  let failed = 0;
  let dead = 0;

  await runWithTenant({ kind: "SYSTEM" }, async () => {
    await prisma.$transaction(async (tx) => {
      const batch = await lockBatch(tx);
      if (batch.length === 0) return;

      for (const row of batch) {
        try {
          await deliverOne(row);
          await tx.eventOutbox.update({
            where: { id: row.id },
            data: { status: "DELIVERED", deliveredAt: new Date() },
          });
          delivered++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (e instanceof RedisPublishError) {
            // Transport failure, not a bad event: keep `attempts`, keep it
            // undelivered, and stop the batch here (see the header).
            await tx.eventOutbox.update({
              where: { id: row.id },
              data: { status: "FAILED", lastError: msg.slice(0, 1000) },
            });
            failed++;
            const now = Date.now();
            if (now - lastRedisWarnAt >= REDIS_WARN_EVERY_MS) {
              lastRedisWarnAt = now;
              console.warn(
                `[outbox-pumper] Redis publish failed, holding the batch for the next tick: ${msg}`,
              );
            }
            break;
          }
          const nextAttempts = row.attempts + 1;
          const isDead = nextAttempts >= MAX_ATTEMPTS;
          await tx.eventOutbox.update({
            where: { id: row.id },
            data: {
              attempts: nextAttempts,
              lastError: msg.slice(0, 1000),
              status: isDead ? "DEAD" : "FAILED",
            },
          });
          if (isDead) dead++;
          else failed++;
          console.warn(
            `[outbox-pumper] delivery failed for ${row.id} (attempt ${nextAttempts}/${MAX_ATTEMPTS}): ${msg}`,
          );
        }
      }

      if (batch.length === BATCH_SIZE) {
        console.warn(
          `[outbox-pumper] saturated tick (${BATCH_SIZE} rows) — backlog growing`,
        );
      }
    }, { maxWait: 5_000, timeout: TX_TIMEOUT_MS });
  });

  return { delivered, failed, dead };
}

/**
 * One retention sweep (audit INF-04). Deletes DELIVERED rows older than
 * 7 days and DEAD rows older than 30, in batches. PENDING and FAILED rows
 * are never touched: they are still to be delivered. Exported for tests.
 */
export async function pruneOutboxOnce(
  now: Date = new Date(),
): Promise<{ delivered: number; dead: number }> {
  const deliveredBefore = new Date(now.getTime() - DELIVERED_RETENTION_MS);
  const deadBefore = new Date(now.getTime() - DEAD_RETENTION_MS);
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const sweep = async (status: "DELIVERED" | "DEAD", before: Date) => {
      let total = 0;
      for (;;) {
        const n = await prisma.$executeRaw`
          DELETE FROM "EventOutbox"
          WHERE id IN (
            SELECT id FROM "EventOutbox"
            WHERE status = ${status}::"OutboxStatus" AND "createdAt" < ${before}
            LIMIT ${PRUNE_BATCH}
          )
        `;
        total += n;
        if (n < PRUNE_BATCH) return total;
      }
    };
    const delivered = await sweep("DELIVERED", deliveredBefore);
    const dead = await sweep("DEAD", deadBefore);
    return { delivered, dead };
  });
}

/** Hourly retention sweep on the shared queue (heartbeat included). */
export function startOutboxRetentionWorker(
  intervalMs: number = RETENTION_EVERY_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<Record<string, never>>(
    RETENTION_QUEUE,
    RETENTION_JOB,
    async () => {
      try {
        const r = await pruneOutboxOnce();
        if (r.delivered > 0 || r.dead > 0) {
          console.info(
            `[outbox-retention] pruned ${r.delivered} delivered, ${r.dead} dead`,
          );
        }
      } catch (e) {
        console.error("[outbox-retention] sweep failed", e);
      }
    },
  );
  const handle = queue.repeat(RETENTION_QUEUE, RETENTION_JOB, {} as never, intervalMs);
  console.info("[worker] outbox-retention registered");
  return handle;
}

/**
 * Start the pumper. Returns a stop handle; idempotent — calling twice with
 * the same intervalMs is harmless because the second interval is also
 * tracked and stopped together.
 */
export function startOutboxPumperWorker(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): { stop: () => void } {
  let running = false;
  const handle = setInterval(() => {
    if (running) return; // skip overlapping ticks
    running = true;
    pumpOnce()
      .then(() => {
        // Liveness (audit INF-01): a pumper that stopped draining is what
        // leaves every live screen stale; health watches this beat.
        recordHeartbeat("outbox-pumper", intervalMs);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[outbox-pumper] tick failed: ${msg}`);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  // Don't keep the event loop alive solely for the pumper — other workers
  // (TG poller, schedulers) own liveness.
  handle.unref?.();
  console.info(`[worker] outbox-pumper registered every ${intervalMs}ms`);
  return {
    stop: () => clearInterval(handle),
  };
}
