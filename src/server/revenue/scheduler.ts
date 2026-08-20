/**
 * Revenue jobs scheduler — Phase 14, Wave 2.
 *
 * Two daily ticks, both modeled on `src/server/actions/scheduler.ts`:
 *
 *   `revenue-snapshot`        ~02:00 Tashkent — for each clinic, snapshot
 *                             yesterday's empty slots. Cheap idempotent
 *                             rewrite per (clinicId, doctorId, date).
 *
 *   `reactivation-scheduler`  ~07:00 Tashkent — for each clinic, run the
 *                             reactivation engine: detect dormant
 *                             patients, gate per quarter, enqueue sends.
 *
 * The in-house queue (`src/server/queue/index.ts`) does not yet support
 * cron expressions — `repeat()` is a `setInterval`. So we let the timer
 * fire every hour and gate the *body* on a "due hour" check in **Tashkent**
 * clinic time (the prod box runs UTC — server-local hours are 5h off the
 * clinic's). The first kick is also gated, so a worker that boots at 11:00
 * won't fire the 07:00 job until tomorrow.
 *
 * Errors per clinic are caught + logged so one bad tenant can't kill the
 * whole pass.
 */
import { prisma } from "@/lib/prisma";
import {
  tashkentDayBounds,
  tashkentComponents,
} from "@/lib/booking-validation";
import { runWithTenant } from "@/lib/tenant-context";
import { getQueue } from "@/server/queue";

import { snapshotEmptySlotsForDay } from "./empty-slot";
import { runReactivationScheduler } from "./reactivation";

export const REVENUE_SNAPSHOT_QUEUE = "revenue:snapshot";
export const REVENUE_SNAPSHOT_JOB = "tick";
export const REACTIVATION_QUEUE = "revenue:reactivation";
export const REACTIVATION_JOB = "tick";

/** Default "run-at" hour (Tashkent 24h clock) for each job. */
export const REVENUE_SNAPSHOT_HOUR = 2;
export const REACTIVATION_HOUR = 7;

/** Default poll interval — once an hour. The body is gated on the hour. */
const POLL_INTERVAL_MS = 60 * 60 * 1000;

type ClinicRow = { id: string };

/**
 * Enumerate active (not soft-deleted) clinics. The `Clinic.active` flag is
 * the closest to a soft-delete in this schema. SUPER_ADMIN context bypasses
 * the tenant scope so we see every row.
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

/** Yesterday's Tashkent midnight (start of the clinic's previous civil day). */
function yesterdayTashkent(now: Date): Date {
  return new Date(tashkentDayBounds(now).dayStart.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * Pure helper: should the job fire on this tick? Compares `now`'s
 * **Tashkent** wall-clock hour against `targetHour`, fires once per
 * Tashkent date. Stateful via the caller's `lastRunDate` set.
 *
 * Exported so the scheduler tests can drive it deterministically.
 */
export function shouldFire(opts: {
  now: Date;
  targetHour: number;
  lastRunOnDate: string | null;
}): boolean {
  const comp = tashkentComponents(opts.now);
  const clinicHour = Math.floor(comp.minutes / 60);
  if (clinicHour !== opts.targetHour) return false;
  return opts.lastRunOnDate !== comp.date;
}

function isoDate(d: Date): string {
  return tashkentComponents(d).date;
}

/**
 * Inner pure-async tick for `revenue-snapshot` — separated from `repeat()`
 * gating so it can be invoked manually by tests / ops scripts.
 */
export async function runRevenueSnapshotPass(now: Date = new Date()): Promise<{
  clinics: number;
  snapshotsWritten: number;
  totalLossUzs: number;
  errors: number;
}> {
  const clinicIds = await listActiveClinicIds();
  const target = yesterdayTashkent(now);
  let snapshotsWritten = 0;
  let totalLossUzs = 0;
  let errors = 0;
  console.info(
    `[revenue-snapshot] start clinics=${clinicIds.length} date=${isoDate(target)}`,
  );
  for (const clinicId of clinicIds) {
    try {
      const res = await snapshotEmptySlotsForDay(prisma, clinicId, target);
      snapshotsWritten += res.snapshotsWritten;
      totalLossUzs += res.totalLossUzs;
    } catch (e) {
      errors += 1;
      console.error(`[revenue-snapshot] clinic=${clinicId} failed`, e);
    }
  }
  console.info(
    `[revenue-snapshot] end clinics=${clinicIds.length} snapshots=${snapshotsWritten} totalLossUzs=${totalLossUzs} errors=${errors}`,
  );
  return {
    clinics: clinicIds.length,
    snapshotsWritten,
    totalLossUzs,
    errors,
  };
}

/**
 * Inner pure-async tick for `reactivation-scheduler` — same pattern as
 * `runRevenueSnapshotPass`.
 */
export async function runReactivationPass(now: Date = new Date()): Promise<{
  clinics: number;
  scanned: number;
  scheduled: number;
  skipped: number;
  errors: number;
}> {
  const clinicIds = await listActiveClinicIds();
  let scanned = 0;
  let scheduled = 0;
  let skipped = 0;
  let errors = 0;
  console.info(
    `[reactivation] start clinics=${clinicIds.length} now=${now.toISOString()}`,
  );
  for (const clinicId of clinicIds) {
    try {
      const res = await runReactivationScheduler(prisma, clinicId, now);
      scanned += res.scanned;
      scheduled += res.scheduled;
      skipped += res.skipped;
    } catch (e) {
      errors += 1;
      console.error(`[reactivation] clinic=${clinicId} failed`, e);
    }
  }
  console.info(
    `[reactivation] end clinics=${clinicIds.length} scanned=${scanned} scheduled=${scheduled} skipped=${skipped} errors=${errors}`,
  );
  return {
    clinics: clinicIds.length,
    scanned,
    scheduled,
    skipped,
    errors,
  };
}

/**
 * Register both daily jobs with the in-memory queue. Returns a `{ stop }`
 * handle — the worker entrypoint wires this into SIGINT/SIGTERM.
 */
export function registerRevenueSchedulers(opts?: {
  intervalMs?: number;
  snapshotHour?: number;
  reactivationHour?: number;
}): { stop: () => void } {
  const intervalMs = opts?.intervalMs ?? POLL_INTERVAL_MS;
  const snapshotHour = opts?.snapshotHour ?? REVENUE_SNAPSHOT_HOUR;
  const reactivationHour = opts?.reactivationHour ?? REACTIVATION_HOUR;

  const q = getQueue();
  let lastSnapshotDate: string | null = null;
  let lastReactivationDate: string | null = null;

  q.registerWorker(REVENUE_SNAPSHOT_QUEUE, REVENUE_SNAPSHOT_JOB, async () => {
    const now = new Date();
    if (
      !shouldFire({
        now,
        targetHour: snapshotHour,
        lastRunOnDate: lastSnapshotDate,
      })
    )
      return;
    lastSnapshotDate = isoDate(now);
    await runRevenueSnapshotPass(now);
  });

  q.registerWorker(REACTIVATION_QUEUE, REACTIVATION_JOB, async () => {
    const now = new Date();
    if (
      !shouldFire({
        now,
        targetHour: reactivationHour,
        lastRunOnDate: lastReactivationDate,
      })
    )
      return;
    lastReactivationDate = isoDate(now);
    await runReactivationPass(now);
  });

  const snapshotHandle = q.repeat(
    REVENUE_SNAPSHOT_QUEUE,
    REVENUE_SNAPSHOT_JOB,
    {},
    intervalMs,
  );
  const reactivationHandle = q.repeat(
    REACTIVATION_QUEUE,
    REACTIVATION_JOB,
    {},
    intervalMs,
  );

  console.info(
    `[worker] revenue-schedulers registered (snapshot ~${String(snapshotHour).padStart(2, "0")}:00, reactivation ~${String(reactivationHour).padStart(2, "0")}:00, poll=${intervalMs}ms)`,
  );

  return {
    stop: () => {
      snapshotHandle.stop();
      reactivationHandle.stop();
    },
  };
}
