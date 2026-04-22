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
 *     db:      { status: "ok" | "down" | "timeout", latencyMs?, error? },
 *     redis:   { status: "ok" | "not_configured" | "down" | "timeout", … },
 *     minio:   { status: "ok" | "stub" | "down" | "timeout", … },
 *     workers: { status: "ok" | "idle", queues?: string[] }
 *   },
 *   generatedAt: string
 * }
 */
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

const CHECK_TIMEOUT_MS = 5_000;

type Check = {
  status: "ok" | "down" | "not_configured" | "stub" | "timeout" | "idle";
  latencyMs?: number;
  error?: string;
  details?: string;
  queues?: string[];
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
    return {
      status: "down",
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
    };
  }
}

async function checkRedis(): Promise<Check> {
  const url = process.env.REDIS_URL;
  if (!url) return { status: "not_configured", details: "REDIS_URL unset — in-memory fallback active" };
  const started = Date.now();
  try {
    // Lazy import so tests / dev without ioredis installed don't fail.
    const mod = (await import("ioredis")) as unknown as {
      default: new (url: string) => {
        ping: () => Promise<string>;
        quit: () => Promise<unknown>;
        disconnect: () => void;
      };
    };
    const Redis = mod.default;
    const client = new Redis(url);
    const res = await withTimeout(() => client.ping(), CHECK_TIMEOUT_MS);
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
    if (res === "__timeout__") return { status: "timeout" };
    return { status: res === "PONG" ? "ok" : "down", latencyMs: Date.now() - started };
  } catch (e) {
    return {
      status: "down",
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
    };
  }
}

async function checkMinio(): Promise<Check> {
  if (!process.env.MINIO_ENDPOINT) {
    return { status: "stub", details: "MINIO_ENDPOINT unset — local /tmp fallback" };
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
    return {
      status: "down",
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
    };
  }
}

function checkWorkers(): Check {
  // The worker process is a separate container; from the app's POV we can
  // only verify the queue abstraction has been bootstrapped. If REDIS_URL
  // is set we're in BullMQ mode — real worker liveness should be checked
  // via its own /metrics or container healthcheck.
  const queues = ["notifications:send", "notifications:scheduler", "exports"];
  return {
    status: "ok",
    queues,
    details: process.env.REDIS_URL ? "bullmq" : "in-memory",
  };
}

function pkgVersion(): string {
  return process.env.APP_VERSION || process.env.NEXT_PUBLIC_APP_VERSION || "dev";
}

export async function GET(): Promise<NextResponse> {
  const [db, redis, minio] = await Promise.all([checkDb(), checkRedis(), checkMinio()]);
  const workers = checkWorkers();

  // Critical checks: db. Redis/minio degrade rather than fail when unset.
  const critical = [db];
  const downCritical = critical.some((c) => c.status === "down" || c.status === "timeout");

  const anyDown = [db, redis, minio, workers].some(
    (c) => c.status === "down" || c.status === "timeout",
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
