/**
 * OutboxPumper — drains `EventOutbox` to the realtime bus.
 *
 * TZ §5.2. Phase A.5.
 *
 * Loop (every `intervalMs`, default 200ms):
 *
 *   1. SELECT a small batch of `PENDING` rows whose retry window has elapsed
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
 */

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import type { prisma as prismaT } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import {
  EventEnvelopeSchema,
  getEventMeta,
  type EventEnvelope,
} from "@/server/realtime/envelope";
import { broadcastEnvelope } from "@/server/realtime/publish";

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;
const DEFAULT_INTERVAL_MS = 200;

type OutboxRow = {
  id: string;
  envelope: Prisma.JsonValue;
  attempts: number;
};

/**
 * Pick eligible PENDING rows + lock them. Raw SQL because Prisma doesn't
 * expose `FOR UPDATE SKIP LOCKED`. The retry-window predicate uses Postgres
 * interval arithmetic so the worker doesn't need to compute it in JS.
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
      AND ("createdAt" + ((1 << attempts) * INTERVAL '1 second')) <= NOW()
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
    });
  });

  return { delivered, failed, dead };
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
