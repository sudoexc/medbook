/**
 * The platform panel's «Здоровье» cards, built from the live checks shared
 * with `/api/health` (audit G5-12). Pure, so the verdicts are testable
 * without Redis or a worker.
 */
import type { Check } from "@/server/observability/service-checks";
import type { WorkersCheck } from "@/server/observability/worker-health";

export type ServiceHealth = {
  name: "postgres" | "redis" | "workers" | "minio";
  status: "ok" | "degraded" | "down" | "not_configured";
  latencyMs?: number | null;
  details?: string | null;
};

/** A check's verdict in the panel's terms: a timeout is down. */
function statusOf(c: { status: Check["status"] }): ServiceHealth["status"] {
  return c.status === "timeout" ? "down" : c.status;
}

export function serviceCard(name: ServiceHealth["name"], c: Check): ServiceHealth {
  return {
    name,
    status: statusOf(c),
    latencyMs: c.latencyMs ?? null,
    details: c.status === "timeout" ? "no answer within 5 s" : (c.details ?? null),
  };
}

/**
 * The workers card: how long ago the worker process last beat, which loops
 * are late, and what it left undone.
 */
export function workersCard(w: WorkersCheck): ServiceHealth {
  return { name: "workers", status: statusOf(w), latencyMs: null, details: workersDetails(w) };
}

function workersDetails(w: WorkersCheck): string | null {
  if (w.status === "timeout") return "no answer within 5 s";
  if (w.status === "not_configured") return w.details ?? null;
  const parts: string[] = [
    typeof w.processAgeSec === "number"
      ? `last process beat ${w.processAgeSec} s ago`
      : "no process beat",
  ];
  if (w.staleLoops?.length) parts.push(`late loops: ${w.staleLoops.join(", ")}`);
  if (w.outbox?.oldestPendingSec != null) {
    parts.push(`outbox pending ${w.outbox.oldestPendingSec} s`);
  }
  if (w.outbox?.dead24h) parts.push(`outbox dead (24h): ${w.outbox.dead24h}`);
  if (w.notifications?.oldestOverdueSec != null) {
    parts.push(`notification overdue ${w.notifications.oldestOverdueSec} s`);
  }
  if (w.documents?.oldestUndeliveredSec != null) {
    parts.push(`document undelivered ${w.documents.oldestUndeliveredSec} s`);
  }
  return parts.join(" · ");
}

/** The overall verdict: any card down or degraded makes it degraded. */
export function overallOf(
  services: ReadonlyArray<Pick<ServiceHealth, "status">>,
): "ok" | "partial" | "degraded" {
  if (services.some((s) => s.status === "down" || s.status === "degraded")) {
    return "degraded";
  }
  return services.every((s) => s.status === "ok") ? "ok" : "partial";
}
