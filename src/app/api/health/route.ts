/**
 * GET /api/health — public readiness probe.
 *
 * No auth. Designed for Docker/K8s + UptimeRobot. Returns 200 if all critical
 * subsystems respond within the per-check timeout, 503 otherwise. Each check
 * has a 5-second budget; total budget capped at ~6s via Promise.race.
 *
 * Output shape:
 * {
 *   status: "ok" | "degraded" | "down",
 *   version: string,
 *   uptime: number,      // seconds since this Node process started
 *   checks: {
 *     db:      { status: "ok" | "down" | "timeout", latencyMs? },
 *     redis:   { status: "ok" | "not_configured" | "degraded" | "down" | "timeout", … },
 *     minio:   { status: "ok" | "not_configured" | "down" | "timeout", … },
 *     workers: { status: "ok" | "degraded" | "down" | "not_configured" | "timeout",
 *                processAgeSec, staleLoops, outbox, notifications }
 *   },
 *   generatedAt: string
 * }
 *
 * Workers (audit INF-01): the worker container beats a heartbeat in Redis
 * (`src/server/observability/worker-heartbeat.ts`). A missing or stopped
 * process beat is `down`; a late loop, an outbox row undelivered for over a
 * minute, a dead-lettered event in the last day or a due notification stuck
 * for half an hour is `degraded`. Either makes the overall status
 * `degraded` (HTTP 200: the site itself still serves), which the watchdog
 * (`ops/watchdog.sh`) alerts on. The check used to return `ok` hard-coded.
 *
 * Redis also reports `degraded` when this process tried to subscribe to the
 * realtime channel and has not managed to (audit INF-17): Redis answers
 * PING, yet no worker event reaches this process's SSE clients.
 *
 * The probe is public, so it never returns error text (a DB error message
 * names hosts and users); details go to the server log. The checks live in
 * `server/observability/service-checks.ts`, shared with the platform panel's
 * «Здоровье» (audit G5-12).
 */
import { NextResponse } from "next/server";

import { checkWorkerHealth } from "@/server/observability/worker-health";
import { checkDb, checkMinio, checkRedis } from "@/server/observability/service-checks";

function pkgVersion(): string {
  return process.env.APP_VERSION || process.env.NEXT_PUBLIC_APP_VERSION || "dev";
}

export async function GET(): Promise<NextResponse> {
  const [db, redis, minio, workers] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkMinio(),
    checkWorkerHealth(),
  ]);

  // Critical checks: db. Redis/minio/workers degrade rather than fail: the
  // site still serves while the background loops are down.
  const critical = [db];
  const downCritical = critical.some((c) => c.status === "down" || c.status === "timeout");

  const anyDown = [db, redis, minio, workers].some(
    (c) => c.status === "down" || c.status === "timeout" || c.status === "degraded",
  );
  const status: "ok" | "degraded" | "down" = downCritical
    ? "down"
    : anyDown
      ? "degraded"
      : "ok";

  const body = {
    status,
    version: pkgVersion(),
    uptime: Math.round(process.uptime()),
    checks: { db, redis, minio, workers },
    generatedAt: new Date().toISOString(),
  };

  const httpStatus = status === "down" ? 503 : 200;
  return NextResponse.json(body, {
    status: httpStatus,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

// Never statically prerender this — it must hit the DB each request.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
