/**
 * Live checks of the services the app depends on, shared by the public
 * probe `/api/health` and the platform panel's «Здоровье»
 * (`/api/platform/health`, audit G5-12: it used to report Redis, BullMQ and
 * MinIO as OK whenever their env variable was set, pinging nothing).
 *
 * Each check has a 5 second budget and never returns error text (a DB error
 * message names hosts and users, and the probe is public); details go to the
 * server log.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getOpsRedis } from "@/server/observability/worker-heartbeat";
import { isRedisSubscriptionHealthy } from "@/server/realtime/redis-adapter";

export const CHECK_TIMEOUT_MS = 5_000;

export type Check = {
  status: "ok" | "down" | "not_configured" | "timeout" | "degraded";
  latencyMs?: number;
  details?: string;
};

export async function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
): Promise<T | "__timeout__"> {
  return Promise.race<T | "__timeout__">([
    fn(),
    new Promise<"__timeout__">((resolve) => setTimeout(() => resolve("__timeout__"), ms)),
  ]);
}

export function logCheckError(check: string, e: unknown): void {
  console.warn(`[health] ${check}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
}

export async function checkDb(): Promise<Check> {
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

export async function checkRedis(): Promise<Check> {
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
    if (res === "PONG" && !isRedisSubscriptionHealthy()) {
      return {
        status: "degraded",
        latencyMs: Date.now() - started,
        details: "realtime subscription not active yet, retrying",
      };
    }
    return { status: res === "PONG" ? "ok" : "down", latencyMs: Date.now() - started };
  } catch (e) {
    logCheckError("redis", e);
    return { status: "down", latencyMs: Date.now() - started };
  }
}

export async function checkMinio(): Promise<Check> {
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
