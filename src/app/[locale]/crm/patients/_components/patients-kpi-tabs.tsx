"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { PlusIcon } from "lucide-react";

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

export type OptionalColumnId =
  | "lastVisitAt"
  | "nextVisitAt"
  | "ltv"
  | "priority"
  | "source";

export interface PatientsKpiTabsProps {
  rows: PatientRow[];
  total: number | null;
  segmentCounts: PatientSegmentCounts | null;
  totalAcrossSegments: number | null;
  active: PatientsTabKey;
  onChange: (next: PatientsTabKey) => void;
  className?: string;
}

export const SEGMENT_TO_TAB: Record<PatientRow["segment"], PatientsTabKey> = {
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

export function PatientsKpiTabs({
  rows,
  total,
  segmentCounts,
  totalAcrossSegments,
  active,
  onChange,
  className,
}: PatientsKpiTabsProps) {
  const t = useTranslations("patients.tabs");
  const locale = useLocale();
  const counts = React.useMemo(() => {
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
      <div className="ml-auto flex shrink-0 items-center pl-2">
        <button
          type="button"
          onClick={() => {
            console.log("TODO: new segment dialog");
          }}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-primary hover:bg-primary/5"
        >
          <PlusIcon className="size-3.5" />
          {t("newSegment")}
        </button>
      </div>
    </div>
  );
}
