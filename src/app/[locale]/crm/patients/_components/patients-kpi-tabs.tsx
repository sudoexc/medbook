"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { FilterIcon, LayoutGridIcon, SettingsIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import type {
  PatientRow,
  PatientSegmentCounts,
} from "../_hooks/use-patients-list";

export type PatientsTabKey =
  | "all"
  | "vip"
  | "new"
  | "active"
  | "dormant"
  | "churn";

export interface PatientsKpiTabsProps {
  rows: PatientRow[];
  total: number | null;
  /** Server-side counts per segment that ignore the segment filter. */
  segmentCounts: PatientSegmentCounts | null;
  /** Sum of segmentCounts (a.k.a. "all" tab badge). */
  totalAcrossSegments: number | null;
  active: PatientsTabKey;
  onChange: (next: PatientsTabKey) => void;
  onOpenFilters?: () => void;
  onOpenSegments?: () => void;
  onConfigureTable?: () => void;
  className?: string;
}

type Tab = { key: PatientsTabKey; segment?: PatientRow["segment"] };

const TABS: Tab[] = [
  { key: "all" },
  { key: "vip", segment: "VIP" },
  { key: "new", segment: "NEW" },
  { key: "active", segment: "ACTIVE" },
  { key: "dormant", segment: "DORMANT" },
  { key: "churn", segment: "CHURN" },
];

/**
 * Smart filter tabs above the patients table — docs/5 - Пациенты (2).png.
 *
 * Counts are derived from already-loaded rows (client-side), with the server
 * "all" total respected where possible.
 */
export function PatientsKpiTabs({
  rows,
  total,
  segmentCounts,
  totalAcrossSegments,
  active,
  onChange,
  onOpenFilters,
  onOpenSegments,
  onConfigureTable,
  className,
}: PatientsKpiTabsProps) {
  const t = useTranslations("patients.tabs");
  const locale = useLocale();
  const counts = React.useMemo(() => {
    // Prefer server-computed counts (independent of the segment filter) so
    // switching tabs doesn't zero out the badges of the inactive ones.
    if (segmentCounts) {
      return {
        all: totalAcrossSegments ?? 0,
        vip: segmentCounts.VIP,
        new: segmentCounts.NEW,
        active: segmentCounts.ACTIVE,
        dormant: segmentCounts.DORMANT,
        churn: segmentCounts.CHURN,
      } satisfies Record<PatientsTabKey, number>;
    }
    // First-render fallback before the query resolves.
    const out: Record<PatientsTabKey, number> = {
      all: total ?? rows.length,
      vip: 0,
      new: 0,
      active: 0,
      dormant: 0,
      churn: 0,
    };
    for (const p of rows) {
      if (p.segment === "VIP") out.vip += 1;
      if (p.segment === "NEW") out.new += 1;
      if (p.segment === "ACTIVE") out.active += 1;
      if (p.segment === "DORMANT") out.dormant += 1;
      if (p.segment === "CHURN") out.churn += 1;
    }
    return out;
  }, [rows, total, segmentCounts, totalAcrossSegments]);

  return (
    <div
      className={cn(
        "flex items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-card px-2 py-1.5 [scrollbar-width:thin]",
        className,
      )}
      role="tablist"
      aria-label={t("ariaLabel")}
    >
      {TABS.map((tab) => {
        const count = counts[tab.key];
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
            {t(tab.key)}
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
              {new Intl.NumberFormat(locale === "uz" ? "uz-UZ" : "ru-RU").format(count)}
            </span>
          </button>
        );
      })}
      <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
        <ToolbarButton icon={FilterIcon} label={t("filters")} onClick={onOpenFilters} />
        <ToolbarButton icon={LayoutGridIcon} label={t("segments")} onClick={onOpenSegments} />
        <ToolbarButton
          icon={SettingsIcon}
          label={t("configureTable")}
          onClick={onConfigureTable}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FilterIcon;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
