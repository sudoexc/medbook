"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SettingsIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StatusBucket } from "../_hooks/use-appointments-filters";

export interface AppointmentsKpiStripProps {
  tally: Record<string, number>;
  active: StatusBucket;
  onChange: (next: StatusBucket) => void;
  className?: string;
}

type TabLabelKey =
  | "needsAttention"
  | "needCall"
  | "riskNoShow"
  | "inProgress"
  | "arrived"
  | "all";

type Tab = {
  key: StatusBucket;
  labelKey: TabLabelKey;
  source: string;
  tone: "primary" | "neutral" | "danger" | "warning" | "success";
};

const TABS: Tab[] = [
  { key: "waiting", labelKey: "needsAttention", source: "WAITING", tone: "primary" },
  { key: "booked", labelKey: "needCall", source: "BOOKED", tone: "neutral" },
  { key: "no_show", labelKey: "riskNoShow", source: "NO_SHOW", tone: "danger" },
  { key: "in_progress", labelKey: "inProgress", source: "IN_PROGRESS", tone: "warning" },
  { key: "completed", labelKey: "arrived", source: "COMPLETED", tone: "success" },
  { key: "all", labelKey: "all", source: "all", tone: "neutral" },
];

/**
 * Smart filter tabs under the tiles — docs/2 - Записи (2).png.
 *
 * Each tab: label + count chip. Selecting a tab sets the `bucket` URL filter.
 * Active tab is painted primary.
 */
export function AppointmentsKpiStrip({
  tally,
  active,
  onChange,
  className,
}: AppointmentsKpiStripProps) {
  const t = useTranslations("appointments.kpiStrip");
  return (
    <div
      role="tablist"
      aria-label={t("ariaLabel")}
      className={cn(
        "flex items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-card px-2 py-1.5 [scrollbar-width:thin]",
        className,
      )}
    >
      {TABS.map((tab) => {
        const count = tally[tab.source] ?? 0;
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(tab.labelKey)}
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[11px] font-bold tabular-nums",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : count > 0
                    ? "bg-muted-foreground/15 text-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <SettingsIcon className="size-3.5" />
        {t("configureView")}
      </button>
    </div>
  );
}
