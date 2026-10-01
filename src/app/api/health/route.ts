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
 *     redis:   { status: "ok" | "not_configured" | "down" | "timeout", … },
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
 * The probe is public, so it never returns error text (a DB error message
 * names hosts and users); details go to the server log.
 */
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getOpsRedis } from "@/server/observability/worker-heartbeat";
import { checkWorkerHealth } from "@/server/observability/worker-health";

const CHECK_TIMEOUT_MS = 5_000;

type Check = {
  status: "ok" | "down" | "not_configured" | "timeout" | "degraded";
  latencyMs?: number;
  details?: string;
};

async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T | "__timeout__"> {
  return Promise.race<T | "__timeout__">([
    fn(),
    new Promise<"__timeout__">((resolve) => setTimeout(() => resolve("__timeout__"), ms)),
  ]);
}

async function checkDb(): Promise<Check> {
  const started = Date.now();
  try {
    // Run outside any tenant scope — bypasses the `$extends` filter.
    const res = await withTimeout(
      () => runWithTenant({ kind: "SYSTEM" }, () => prisma.$queryRawUnsafe<unknown>("SELECT 1")),
      CHECK_TIMEOUT_MS,
    );
    if (res === "__timeout__") return { status: "timeout" };
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (e) {
    logCheckError("db", e);
    return { status: "down", latencyMs: Date.now() - started };
  }
}

function logCheckError(check: string, e: unknown): void {
  console.warn(`[health] ${check}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
}

async function checkRedis(): Promise<Check> {
  if (!process.env.REDIS_URL) {
    return { status: "not_configured", details: "REDIS_URL unset — in-memory fallback active" };
  }
  const started = Date.now();
  try {
    // One shared connection (audit INF-01): this public probe used to open a
    // new TCP connection to Redis on every request.
    const res = await withTimeout(async () => {
      const client = await getOpsRedis();
      return client ? client.ping() : "NO_CLIENT";
    }, CHECK_TIMEOUT_MS);
    if (res === "__timeout__") return { status: "timeout" };
    return { status: res === "PONG" ? "ok" : "down", latencyMs: Date.now() - started };
  } catch (e) {
    logCheckError("redis", e);
    return { status: "down", latencyMs: Date.now() - started };
  }
}

async function checkMinio(): Promise<Check> {
  if (!process.env.MINIO_ENDPOINT) {
    return {
      status: "not_configured",
      details: "MINIO_ENDPOINT unset — local /tmp fallback",
    };
  }
  const started = Date.now();
  try {
    // Best-effort HEAD on the health path. We deliberately avoid actually
    // writing a probe object on every hit.
    const res = await withTimeout(async () => {
      const endpoint = process.env.MINIO_ENDPOINT!.replace(/\/$/, "");
      const r = await fetch(`${endpoint}/minio/health/ready`, { method: "GET" });
      return r.ok;
    }, CHECK_TIMEOUT_MS);
    if (res === "__timeout__") return { status: "timeout" };
    return { status: res ? "ok" : "down", latencyMs: Date.now() - started };
  } catch (e) {
    logCheckError("minio", e);
    return { status: "down", latencyMs: Date.now() - started };
  }
}

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
