/**
 * Action Center recompute scheduler — Phase 13 Wave 2.
 *
 * Wakes every 15 minutes, iterates active clinics, and runs `runActionEngine`
 * inside a `runWithTenant({ kind: "TENANT", clinicId, ... })` boundary so the
 * Prisma tenant-scope extension correctly filters reads/writes per clinic.
 *
 * Modeled on `src/server/notifications/triggers.ts` (clinic enumeration) and
 * `src/server/workers/notifications-scheduler.ts` (queue worker registration).
 *
 * Idempotency: the engine's repository (`upsertAction`) already deduplicates
 * via `(clinicId, dedupeKey)`, so re-firing the recompute is safe — the worst
 * case is a no-op pass with `skipped` count climbing.
 *
 * Boot path: register from `src/server/workers/start.ts` alongside the other
 * background schedulers. The function returns a `{ stop }` handle so the
 * SIGINT/SIGTERM shutdown sequence can clean up the repeating timer.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getQueue } from "@/server/queue";

import { runActionEngine } from "./engine";

export const QUEUE_NAME = "actions";
export const JOB_NAME = "actions-recompute";
const RECOMPUTE_INTERVAL_MS = 15 * 60 * 1000;

type ClinicRow = { id: string };

/**
 * Pure helper: enumerate active clinics. Exported so tests can stub it.
 * SUPER_ADMIN context bypasses the tenant scope, so we see every clinic.
 */
export async function listActiveClinicIds(): Promise<string[]> {
  const rows = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findMany({
      where: { active: true },
      select: { id: true },
    }),
  )) as ClinicRow[];
  return rows.map((r) => r.id);
}

/**
 * Worker entry: run the engine for each active clinic.
 *
 * We iterate sequentially per clinic to bound DB load — the engine fires up
 * to 10 detector reads + N upserts per clinic, and parallelizing across
 * clinics for a 100-tenant install would saturate the connection pool.
 */
async function tick(): Promise<void> {
  const clinicIds = await listActiveClinicIds();
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalExpired = 0;
  let totalErrors = 0;
  for (const clinicId of clinicIds) {
    try {
      // Each clinic runs in its own tenant context so detector queries are
      // scoped automatically by the Prisma extension. The engine itself does
      // not call `runWithTenant`.
      const ctx = {
        kind: "TENANT" as const,
        clinicId,
        userId: "system:action-engine",
        role: "ADMIN" as const,
      };
      const res = await runWithTenant(ctx, () =>
        runActionEngine(prisma, clinicId, new Date()),
      );
      totalCreated += res.created;
      totalUpdated += res.updated;
      totalSkipped += res.skipped;
      totalExpired += res.expired;
      totalErrors += res.errors.length;
    } catch (e) {
      totalErrors += 1;
      console.error(`[action-engine] clinic=${clinicId} failed`, e);
    }
  }
  console.info(
    `[action-engine] tick ok clinics=${clinicIds.length} created=${totalCreated} updated=${totalUpdated} skipped=${totalSkipped} expired=${totalExpired} errors=${totalErrors}`,
  );
}

/**
 * Register the recompute worker + repeating timer with the in-memory queue
 * adapter. Returns a `{ stop }` handle (mirrors the other schedulers).
 */
export function registerActionScheduler(
  intervalMs = RECOMPUTE_INTERVAL_MS,
): { stop: () => void } {
  const q = getQueue();
  q.registerWorker(QUEUE_NAME, JOB_NAME, tick);
  const handle = q.repeat(QUEUE_NAME, JOB_NAME, {}, intervalMs);
  console.info(
    `[worker] action-engine-scheduler registered every ${intervalMs}ms`,
  );
  return handle;
}

export { tick as _tickForTests };
