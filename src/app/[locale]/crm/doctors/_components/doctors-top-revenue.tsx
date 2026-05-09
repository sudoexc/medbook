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
 * Bottom-row widget: "Топ врачей по выручке" — ranked list of 5 with +% deltas.
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

  // Synthetic +% deltas derived from doctor position in the list to match the
  // layout of the mockup; will be replaced once we have a prior-period hook.
  const deltas = [12, 8, 15, 5, -10];

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
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
                      ? "bg-success/15 text-success"
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
  );
}

