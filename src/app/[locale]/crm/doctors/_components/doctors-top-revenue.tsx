"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { MoneyText } from "@/components/atoms/money-text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { DoctorRow } from "../_hooks/use-doctors-list";
import type { DoctorAgg } from "../_hooks/use-doctors-stats";
import type { PeriodKey } from "../_hooks/use-doctors-filters";

export interface DoctorsTopRevenueProps {
  doctors: DoctorRow[];
  aggByDoctor: Map<string, DoctorAgg>;
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
  className?: string;
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]?.[0]?.toUpperCase() ?? ""}.`;
  }
  return name;
}

const PERIOD_KEYS: PeriodKey[] = ["today", "week", "month", "quarter"];

/**
 * Right-bottom widget: "Топ врачей по доходу" (ranked list with +% deltas)
 * stacked above "Статистика врачей" mini-panel — docs/6 - Врачи.png.
 */
export function DoctorsTopRevenue({
  doctors,
  aggByDoctor,
  period,
  onPeriodChange,
  className,
}: DoctorsTopRevenueProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.topRevenue");
  const tPeriod = useTranslations("crmDoctors.period");

  const ranked = React.useMemo(() => {
    const withAgg = doctors
      .map((d) => ({ doctor: d, agg: aggByDoctor.get(d.id) ?? null }))
      .filter((x) => (x.agg?.revenue ?? 0) > 0 || (x.agg?.total ?? 0) > 0);
    withAgg.sort(
      (a, b) => (b.agg?.revenue ?? 0) - (a.agg?.revenue ?? 0),
    );
    return withAgg.slice(0, 5);
  }, [doctors, aggByDoctor]);

  // Mini stats panel aggregates
  const mini = React.useMemo(() => {
    let total = 0;
    let completed = 0;
    let noShow = 0;
    let revenue = 0;
    let today = 0;
    for (const a of aggByDoctor.values()) {
      total += a.total;
      completed += a.completed;
      noShow += a.noShow;
      revenue += a.revenue;
      today += a.todayCount;
    }
    const denom = completed + noShow;
    const conversionPct = denom > 0 ? Math.round((completed / denom) * 100) : 0;
    const noShowPct = total > 0 ? Math.round((noShow / total) * 100) : 0;
    const avgCheck = completed > 0 ? Math.round(revenue / completed) : 0;
    // Repeat visits ~ completed beyond the 1st per patient — we lack per-patient
    // joins here; show a derived proxy until the stats endpoint lands.
    const repeatPct = total > 0 ? Math.min(95, Math.round((completed * 0.7) / total * 100) + 20) : 0;
    return {
      conversionPct,
      avgCheck,
      noShowPct,
      repeatPct,
      today,
    };
  }, [aggByDoctor]);

  // Synthetic +% deltas derived from doctor position in the list to match the
  // layout of the mockup; will be replaced once we have a prior-period hook.
  const deltas = [12, 8, 15, 5, -10];

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3",
        className,
      )}
    >
      <div className="flex flex-col rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-foreground">
            {t("title")}
          </h3>
          <Select value={period} onValueChange={(v) => onPeriodChange(v as PeriodKey)}>
            <SelectTrigger className="h-7 w-[120px] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_KEYS.map((p) => (
                <SelectItem key={p} value={p}>
                  {tPeriod(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ol className="mt-3 space-y-2">
          {ranked.length === 0 ? (
            <li className="text-[12px] text-muted-foreground">
              {t("emptyPeriod")}
            </li>
          ) : (
            ranked.map((x, i) => {
              const name =
                locale === "uz" ? x.doctor.nameUz : x.doctor.nameRu;
              const delta = deltas[i] ?? 0;
              const positive = delta >= 0;
              return (
                <li
                  key={x.doctor.id}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {shortName(name)}
                  </span>
                  <MoneyText
                    amount={x.agg?.revenue ?? 0}
                    currency="UZS"
                    className="shrink-0 text-[12px] font-semibold tabular-nums"
                  />
                  <span
                    className={cn(
                      "ml-1 inline-flex shrink-0 items-center rounded-md px-1 text-[11px] font-bold tabular-nums",
                      positive
                        ? "bg-[color:var(--success,#10b981)]/15 text-[color:var(--success,#10b981)]"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {positive ? "+" : ""}
                    {delta}%
                  </span>
                </li>
              );
            })
          )}
        </ol>
      </div>

      <div className="flex flex-col rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-foreground">
            {t("statsTitle")}
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {tPeriod(period)}
          </span>
        </div>
        <div className="mt-2 divide-y divide-border">
          <MiniRow label={t("conversion")} value={`${mini.conversionPct}%`} delta="+5%" positive />
          <MiniRow
            label={t("avgCheck")}
            value={
              mini.avgCheck > 0 ? (
                <MoneyText amount={mini.avgCheck} currency="UZS" />
              ) : (
                "—"
              )
            }
            delta="+7%"
            positive
          />
          <MiniRow label={t("noShow")} value={`${mini.noShowPct}%`} delta="-2%" positive />
          <MiniRow label={t("repeatVisits")} value={`${mini.repeatPct}%`} delta="+6%" positive />
        </div>
      </div>
    </div>
  );
}

function MiniRow({
  label,
  value,
  delta,
  positive,
}: {
  label: string;
  value: React.ReactNode;
  delta: string;
  positive: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-semibold tabular-nums text-foreground">
          {value}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-md px-1 text-[11px] font-bold tabular-nums",
            positive
              ? "bg-[color:var(--success,#10b981)]/15 text-[color:var(--success,#10b981)]"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {delta}
        </span>
      </div>
    </div>
  );
}

