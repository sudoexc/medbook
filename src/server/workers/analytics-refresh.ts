/**
 * Phase 18 Wave 1 — analytics materialized-view refresher.
 *
 * Hourly tick refreshes the four analytics MVs created in
 * `20260507130000_phase18_w1_analytics_foundation`:
 *
 *   - mv_doctor_performance
 *   - mv_cohort_retention
 *   - mv_financial_pace
 *   - mv_schedule_heatmap
 *
 * Refresh strategy
 * ----------------
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires every view to have a
 * UNIQUE index on its natural key — see migration. CONCURRENTLY swaps the
 * data without an AccessExclusiveLock, so resolvers reading the MV stay
 * unblocked while the refresh runs. Trade-off: a CONCURRENTLY refresh
 * needs a few seconds longer than a plain REFRESH. Worth it because the
 * /crm/analytics dashboard can't tolerate a multi-second read stall on
 * the hour.
 *
 * First refresh on boot
 * ---------------------
 * The migration creates all four MVs WITH NO DATA so the migration itself
 * stays cheap (no full Appointment scan during prisma migrate). The first
 * REFRESH on a freshly-created MV cannot use CONCURRENTLY (no rows to
 * compare against) — we detect "no rows" via pg_class.relispopulated and
 * fall back to a plain REFRESH for that one-shot bootstrap.
 *
 * Manual trigger
 * --------------
 * `POST /api/crm/analytics/refresh` (ADMIN-only) runs the same refresh
 * synchronously and audits ANALYTICS_VIEWS_REFRESHED. The hourly cron
 * deliberately does NOT audit — it would spam the AuditLog with 24
 * meaningless rows per day per clinic.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getQueue } from "@/server/queue";

export const ANALYTICS_MV_NAMES = [
  "mv_doctor_performance",
  "mv_cohort_retention",
  "mv_financial_pace",
  "mv_schedule_heatmap",
] as const;

export type AnalyticsMvName = (typeof ANALYTICS_MV_NAMES)[number];

export interface RefreshResult {
  totalMs: number;
  perView: Array<{ name: AnalyticsMvName; ms: number; rowsAfter: number }>;
  failures: Array<{ name: AnalyticsMvName; error: string }>;
}

/**
 * Minimal raw-SQL contract — the worker depends on this so unit tests can
 * pass a stub instead of a real Prisma client.
 */
export interface AnalyticsRefreshClient {
  $queryRawUnsafe: <T = unknown>(sql: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
}

interface RelStatus {
  relispopulated: boolean;
  rowCount: number | bigint | null;
}

async function inspectMv(
  client: AnalyticsRefreshClient,
  name: string,
): Promise<RelStatus> {
  // pg_class.relispopulated → false until the first non-empty REFRESH lands.
  const rows = await client.$queryRawUnsafe<
    { relispopulated: boolean }[]
  >(
    `SELECT c.relispopulated
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'm' AND c.relname = $1
     LIMIT 1`,
    name,
  );
  const populated = rows[0]?.relispopulated === true;

  // We can only count rows once the MV is populated — otherwise the SELECT
  // throws. The count is informational (per-view log line); not load-bearing.
  let rowCount: number | bigint | null = null;
  if (populated) {
    try {
      const c = await client.$queryRawUnsafe<{ count: bigint | number }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "${name}"`,
      );
      rowCount = c[0]?.count ?? 0;
    } catch {
      rowCount = null;
    }
  }
  return { relispopulated: populated, rowCount };
}

const SLOW_MS = 5_000;

export async function refreshOneMv(
  client: AnalyticsRefreshClient,
  name: AnalyticsMvName,
): Promise<{ ms: number; rowsAfter: number }> {
  const status = await inspectMv(client, name);
  // First refresh on a WITH NO DATA MV cannot run CONCURRENTLY — Postgres
  // requires the view to be populated and have at least one unique index.
  // Subsequent refreshes use CONCURRENTLY so resolvers stay unblocked.
  const sql = status.relispopulated
    ? `REFRESH MATERIALIZED VIEW CONCURRENTLY "${name}"`
    : `REFRESH MATERIALIZED VIEW "${name}"`;
  const startedAt = Date.now();
  await client.$executeRawUnsafe(sql);
  const ms = Date.now() - startedAt;
  let rowsAfter = 0;
  try {
    const c = await client.$queryRawUnsafe<{ count: bigint | number }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "${name}"`,
    );
    rowsAfter = Number(c[0]?.count ?? 0);
  } catch {
    rowsAfter = 0;
  }
  if (ms > SLOW_MS) {
    console.warn(
      `[analytics-refresh] ${name} took ${ms}ms (slow >${SLOW_MS}ms) — consider tuning`,
    );
  } else {
    console.info(
      `[analytics-refresh] ${name} refreshed in ${ms}ms (${rowsAfter} rows)`,
    );
  }
  return { ms, rowsAfter };
}

/**
 * Refresh every MV in declaration order. A failure on one MV is logged and
 * does NOT abort the rest — keeps a partially-broken view from blacking
 * out the whole analytics dashboard.
 *
 * Exported for unit tests + the manual /api/crm/analytics/refresh handler.
 */
export async function refreshAllAnalyticsMvs(
  client: AnalyticsRefreshClient,
): Promise<RefreshResult> {
  const startedAt = Date.now();
  const perView: RefreshResult["perView"] = [];
  const failures: RefreshResult["failures"] = [];
  for (const name of ANALYTICS_MV_NAMES) {
    try {
      const { ms, rowsAfter } = await refreshOneMv(client, name);
      perView.push({ name, ms, rowsAfter });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[analytics-refresh] ${name} failed:`, msg);
      failures.push({ name, error: msg });
    }
  }
  return { totalMs: Date.now() - startedAt, perView, failures };
}

const QUEUE = "analytics:refresh";
const JOB = "tick";
const HOURLY_MS = 60 * 60 * 1000;

/**
 * Boot the hourly refresh cron + register the worker. Returns a stop handle.
 *
 * Also kicks off an initial refresh on next-tick (do not block boot — the
 * Next dev server starts the worker module via `start.ts` and the first
 * REFRESH on a populated database can take seconds).
 */
export function startAnalyticsRefreshWorker(
  intervalMs: number = HOURLY_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<{ tick: true }>(QUEUE, JOB, async () => {
    await runWithTenant({ kind: "SYSTEM" }, async () => {
      await refreshAllAnalyticsMvs(prisma);
    });
  });
  const handle = queue.repeat<{ tick: true }>(QUEUE, JOB, { tick: true }, intervalMs);

  // Async kickoff — don't await; lets the worker process boot fully before
  // we start a potentially slow REFRESH.
  void runWithTenant({ kind: "SYSTEM" }, async () => {
    try {
      const result = await refreshAllAnalyticsMvs(prisma);
      console.info(
        `[analytics-refresh] initial refresh: ${result.perView.length} ok, ${result.failures.length} failed, ${result.totalMs}ms total`,
      );
    } catch (err) {
      console.error("[analytics-refresh] initial refresh failed", err);
    }
  });

  console.info("[worker] analytics:refresh registered (hourly)");
  return handle;
}
