/**
 * GET /api/platform/health — system health checks for the admin dashboard.
 *
 * Real checks, the same ones the public probe `/api/health` runs (audit
 * G5-12, `server/observability/service-checks.ts`): Postgres `SELECT 1`,
 * Redis PING, MinIO's readiness endpoint, and the workers (heartbeats in
 * Redis plus the backlog of the tables they drain,
 * `server/observability/worker-health.ts`). Redis, BullMQ and MinIO used to
 * be «OK» whenever their env variable was set, so the panel stayed green
 * exactly when Redis or the worker was down and reminders stopped.
 */
import { ok } from "@/server/http";
import { createPlatformListHandler } from "@/server/platform/handler";
import {
  checkDb,
  checkMinio,
  checkRedis,
} from "@/server/observability/service-checks";
import { checkWorkerHealth } from "@/server/observability/worker-health";
import {
  overallOf,
  serviceCard,
  workersCard,
  type ServiceHealth,
} from "@/server/platform/health-cards";

export const GET = createPlatformListHandler(async () => {
  const [pg, redis, minio, workers] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkMinio(),
    checkWorkerHealth(),
  ]);
  const services: ServiceHealth[] = [
    serviceCard("postgres", pg),
    serviceCard("redis", redis),
    workersCard(workers),
    serviceCard("minio", minio),
  ];
  return ok({
    overall: overallOf(services),
    generatedAt: new Date().toISOString(),
    services,
    env: {
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
  });
});
