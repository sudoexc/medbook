"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckIcon,
  FilterIcon,
  LayoutGridIcon,
  SettingsIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

export type OptionalColumnId =
  | "lastVisitAt"
  | "nextVisitAt"
  | "ltv"
  | "priority"
  | "source";

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
  onSelectSegment?: (segment: PatientRow["segment"] | undefined) => void;
  visibleColumns?: Record<OptionalColumnId, boolean>;
  onToggleColumn?: (id: OptionalColumnId, next: boolean) => void;
  className?: string;
}

const SEGMENT_TO_TAB: Record<PatientRow["segment"], PatientsTabKey> = {
  VIP: "vip",
  NEW: "new",
  ACTIVE: "active",
  DORMANT: "dormant",
  CHURN: "churn",
};

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
  onSelectSegment,
  visibleColumns,
  onToggleColumn,
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
        <SegmentsMenu
          active={active}
          counts={counts}
          onSelect={(seg) => {
            const next = onSelectSegment;
            if (!next) return;
            // Toggle off if same segment is picked again.
            const currentSeg = active === "all" ? undefined : (Object.entries(SEGMENT_TO_TAB).find(([, tab]) => tab === active)?.[0] as PatientRow["segment"] | undefined);
            next(currentSeg === seg ? undefined : seg);
          }}
        />
        <TableConfigMenu
          visibleColumns={visibleColumns}
          onToggleColumn={onToggleColumn}
        />
      </div>
    </div>
  );
}

const SEGMENT_OPTIONS: Array<{
  segment: PatientRow["segment"];
  tabKey: PatientsTabKey;
}> = [
  { segment: "VIP", tabKey: "vip" },
  { segment: "NEW", tabKey: "new" },
  { segment: "ACTIVE", tabKey: "active" },
  { segment: "DORMANT", tabKey: "dormant" },
  { segment: "CHURN", tabKey: "churn" },
];

function SegmentsMenu({
  active,
  counts,
  onSelect,
}: {
  active: PatientsTabKey;
  counts: Record<PatientsTabKey, number>;
  onSelect: (segment: PatientRow["segment"]) => void;
}) {
  const t = useTranslations("patients.tabs");
  const locale = useLocale();
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale === "uz" ? "uz-UZ" : "ru-RU").format(n);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LayoutGridIcon className="size-3.5" />
          {t("segments")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t("segments")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SEGMENT_OPTIONS.map(({ segment, tabKey }) => {
          const isActive = active === tabKey;
          return (
            <DropdownMenuItem
              key={segment}
              onSelect={() => onSelect(segment)}
              className="flex items-center justify-between gap-3 text-[13px]"
            >
              <span className="inline-flex items-center gap-2">
                {isActive ? (
                  <CheckIcon className="size-3.5 text-primary" />
                ) : (
                  <span className="size-3.5" aria-hidden />
                )}
                {t(tabKey)}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {fmt(counts[tabKey])}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COLUMN_LABEL_KEY: Record<OptionalColumnId, string> = {
  lastVisitAt: "columns.lastVisit",
  nextVisitAt: "columns.nextVisit",
  ltv: "columns.ltv",
  priority: "columns.priority",
  source: "columns.source",
};

function TableConfigMenu({
  visibleColumns,
  onToggleColumn,
}: {
  visibleColumns?: Record<OptionalColumnId, boolean>;
  onToggleColumn?: (id: OptionalColumnId, next: boolean) => void;
}) {
  const t = useTranslations("patients");
  const tt = useTranslations("patients.tabs");
  const disabled = !visibleColumns || !onToggleColumn;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <SettingsIcon className="size-3.5" />
          {tt("configureTable")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {tt("configureTable")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(COLUMN_LABEL_KEY) as OptionalColumnId[]).map((id) => {
          const isOn = visibleColumns?.[id] ?? true;
          return (
            <DropdownMenuCheckboxItem
              key={id}
              checked={isOn}
              disabled={disabled}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(next) => onToggleColumn?.(id, Boolean(next))}
              className="text-[13px]"
            >
              {t(COLUMN_LABEL_KEY[id] as never)}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
