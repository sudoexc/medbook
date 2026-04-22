"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleHelpIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";

interface ServiceHealth {
  name: "postgres" | "redis" | "bullmq" | "minio";
  status: "ok" | "down" | "not_configured";
  latencyMs?: number | null;
  details?: string | null;
}

interface HealthResp {
  overall: "ok" | "partial" | "degraded";
  generatedAt: string;
  services: ServiceHealth[];
  env: { nodeEnv: string };
}

async function fetchHealth(): Promise<HealthResp> {
  const r = await fetch("/api/platform/health", { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as HealthResp;
}

const LABELS: Record<ServiceHealth["name"], string> = {
  postgres: "PostgreSQL",
  redis: "Redis",
  bullmq: "BullMQ",
  minio: "MinIO (S3)",
};

export function HealthPageClient() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "health"],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Здоровье</h1>
          <p className="text-sm text-muted-foreground">
            Статус зависимостей инсталляции
            {data && ` · обновлено ${new Date(data.generatedAt).toLocaleTimeString()}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCwIcon className={isFetching ? "animate-spin" : ""} />
          Обновить
        </Button>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Загрузка…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Error"}
        </div>
      )}
      {data && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.services.map((s) => (
            <ServiceCard key={s.name} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard({ s }: { s: ServiceHealth }) {
  const { icon, tone } = iconFor(s.status);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`${tone}`}>{icon}</span>
          <span className="text-sm font-semibold text-foreground">
            {LABELS[s.name]}
          </span>
        </div>
        <span className={`text-xs font-medium ${tone}`}>
          {s.status.toUpperCase().replace("_", " ")}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {typeof s.latencyMs === "number" && (
          <div>Latency: {s.latencyMs}ms</div>
        )}
        {s.details && <div>{s.details}</div>}
      </div>
    </div>
  );
}

function iconFor(status: ServiceHealth["status"]) {
  switch (status) {
    case "ok":
      return { icon: <CheckCircle2Icon className="size-5" />, tone: "text-primary" };
    case "down":
      return { icon: <XCircleIcon className="size-5" />, tone: "text-destructive" };
    case "not_configured":
      return {
        icon: <CircleHelpIcon className="size-5" />,
        tone: "text-muted-foreground",
      };
    default:
      return {
        icon: <CircleAlertIcon className="size-5" />,
        tone: "text-muted-foreground",
      };
  }
}
