"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { StatusBucket } from "../_hooks/use-appointments-filters";

export interface AppointmentsKpiStripProps {
  tally: Record<string, number>;
  active: StatusBucket;
  onChange: (next: StatusBucket) => void;
  className?: string;
}

const BUCKETS: Array<{ key: StatusBucket; sourceKey: string; tone: string }> = [
  { key: "all", sourceKey: "all", tone: "text-foreground" },
  { key: "waiting", sourceKey: "WAITING", tone: "text-[color:var(--warning-foreground)]" },
  { key: "booked", sourceKey: "BOOKED", tone: "text-[color:var(--info)]" },
  { key: "in_progress", sourceKey: "IN_PROGRESS", tone: "text-foreground" },
  { key: "completed", sourceKey: "COMPLETED", tone: "text-[color:var(--success)]" },
  { key: "cancelled", sourceKey: "CANCELLED", tone: "text-destructive" },
  { key: "no_show", sourceKey: "NO_SHOW", tone: "text-muted-foreground" },
];

/**
 * 7 small counters above the table (TZ §6.2.1). Click = filter by status.
 *
 * Counts are derived from rows already loaded into the current page; a
 * whole-filter-set count is deferred to api-builder (see TODO in report).
 */
export function AppointmentsKpiStrip({
  tally,
  active,
  onChange,
  className,
}: AppointmentsKpiStripProps) {
  const t = useTranslations("appointments.kpi");

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5",
        className,
      )}
      role="tablist"
      aria-label={t("label")}
    >
      {BUCKETS.map((b) => {
        const count = tally[b.sourceKey] ?? 0;
        const isActive = active === b.key;
        return (
          <button
            key={b.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(b.key)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              "hover:bg-muted",
              isActive && "bg-primary/10 ring-1 ring-primary/30",
            )}
          >
            <span className="text-muted-foreground">{t(b.key)}</span>{" "}
            <span className={cn("font-semibold", isActive ? "text-primary" : b.tone)}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
