"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { SettingsIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type DoctorsTabKey =
  | "all"
  | "idle"
  | "optimal"
  | "overloaded"
  | "has-slots";

export interface DoctorsKpiTabsProps {
  counts: Record<DoctorsTabKey, number>;
  active: DoctorsTabKey;
  onChange: (next: DoctorsTabKey) => void;
  onConfigureView?: () => void;
  className?: string;
}

type Tab = {
  key: DoctorsTabKey;
  dotClass?: string;
};

const TABS: Tab[] = [
  { key: "all" },
  { key: "idle", dotClass: "bg-destructive" },
  { key: "optimal", dotClass: "bg-[color:var(--warning,#f59e0b)]" },
  { key: "overloaded", dotClass: "bg-destructive" },
  { key: "has-slots", dotClass: "bg-[color:var(--success,#10b981)]" },
];

/**
 * Segmented filter tabs above the doctors carousel — docs/6 - Врачи.png
 * (right side of the "Быстрая запись к врачу" row).
 */
export function DoctorsKpiTabs({
  counts,
  active,
  onChange,
  onConfigureView,
  className,
}: DoctorsKpiTabsProps) {
  const t = useTranslations("crmDoctors.tabs");
  const locale = useLocale();
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
        const count = counts[tab.key] ?? 0;
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
            {tab.dotClass ? (
              <span
                className={cn("size-2 shrink-0 rounded-full", tab.dotClass)}
                aria-hidden
              />
            ) : null}
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
      <button
        type="button"
        onClick={onConfigureView}
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <SettingsIcon className="size-3.5" />
        {t("configureView")}
      </button>
    </div>
  );
}
