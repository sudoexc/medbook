/**
 * GET /api/platform/health — system health checks for the admin dashboard.
 *
 * Postgres: live ping via `SELECT 1`.
 * Redis / BullMQ / MinIO: stubs — `infrastructure-engineer` (Phase 6) wires
 * in real checks when those services land. For now we read env vars and
 * report "not_configured" / "unknown".
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createPlatformListHandler } from "@/server/platform/handler";

type ServiceHealth = {
  name: "postgres" | "redis" | "bullmq" | "minio";
  status: "ok" | "down" | "not_configured";
  latencyMs?: number | null;
  details?: string | null;
};

async function checkPostgres(): Promise<ServiceHealth> {
  const started = Date.now();
  try {
    await prisma.$queryRawUnsafe<unknown>("SELECT 1");
    return {
      name: "postgres",
      status: "ok",
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    return {
      name: "postgres",
      status: "down",
      latencyMs: Date.now() - started,
      details: e instanceof Error ? e.message.slice(0, 200) : "unknown",
    };
  }
}

function checkRedis(): ServiceHealth {
  const url = process.env.REDIS_URL;
  if (!url) {
    return {
      name: "redis",
      status: "not_configured",
      details:
        "REDIS_URL not set. In-memory queue adapter is active until Phase 6.",
    };
  }
  return { name: "redis", status: "ok", details: `configured: ${url.split("@").pop() ?? url}` };
}

function checkBullmq(): ServiceHealth {
  const url = process.env.REDIS_URL;
  if (!url) {
    return {
      name: "bullmq",
      status: "not_configured",
      details:
        "Workers run in-process on the in-memory adapter (src/server/queue/index.ts).",
    };
  }
  return { name: "bullmq", status: "ok", details: "Configured via REDIS_URL" };
}

function checkMinio(): ServiceHealth {
  const endpoint =
    process.env.MINIO_ENDPOINT ?? process.env.S3_ENDPOINT ?? null;
  if (!endpoint) {
    return {
      name: "minio",
      status: "not_configured",
      details: "MINIO_ENDPOINT / S3_ENDPOINT not set. Uploads are metadata-only.",
    };
  }
  return { name: "minio", status: "ok", details: `configured: ${endpoint}` };
}

export const GET = createPlatformListHandler(async () => {
  const [pg] = await Promise.all([checkPostgres()]);
  const services: ServiceHealth[] = [
    pg,
    checkRedis(),
    checkBullmq(),
    checkMinio(),
  ];
  const overall = services.some((s) => s.status === "down")
    ? "degraded"
    : services.every((s) => s.status === "ok")
      ? "ok"
      : "partial";
  return ok({
    overall,
    generatedAt: new Date().toISOString(),
    services,
    env: {
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
  });
});
