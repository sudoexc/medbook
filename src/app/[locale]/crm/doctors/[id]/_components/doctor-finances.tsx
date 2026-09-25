"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BanknoteIcon,
  CalendarDaysIcon,
  PercentIcon,
  TrendingUpIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { MoneyText } from "@/components/atoms/money-text";
import { KpiTile } from "@/components/atoms/kpi-tile";

import { useDoctorFinance } from "../_hooks/use-doctor-finance";
import { usePeriodRange, type PeriodKey } from "../../_hooks/use-doctors-filters";
import { useDoctorsStats } from "../../_hooks/use-doctors-stats";

const PERIODS: PeriodKey[] = ["today", "week", "month", "quarter"];

export interface DoctorFinancesProps {
  doctorId: string;
  /** Latest FX rate, cents/tiin. If null we skip the USD secondary line. */
  usdRate?: number | null;
  className?: string;
}

function computeUsd(uzs: number, rateTiinPerCent: number | null | undefined): number | null {
  if (!rateTiinPerCent || rateTiinPerCent <= 0) return null;
  // rate: 1 USD cent == `rateTiinPerCent` tiin. Convert uzs tiin → usd cent.
  return Math.round(uzs / rateTiinPerCent);
}

export function DoctorFinances({
  doctorId,
  usdRate = null,
  className,
}: DoctorFinancesProps) {
  const t = useTranslations("crmDoctors.finance");
  const tPeriod = useTranslations("crmDoctors.period");
  const [period, setPeriod] = React.useState<PeriodKey>("month");
  const range = usePeriodRange(period);

  const finance = useDoctorFinance(doctorId, range);
  // Avg check and no-show rate from the grouped stats of the same period
  // (DR-01: the raw-rows request was refused with a 400 and read as 0).
  const stats = useDoctorsStats(range, doctorId);

  const extra = React.useMemo(() => {
    const row = stats.data?.find((r) => r.doctorId === doctorId);
    if (!row) return { avgCheck: 0, noShowRate: 0 };
    const eligible = row.completed + row.noShow + row.cancelled;
    const avgCheck =
      row.completed > 0 ? Math.round(row.revenue / row.completed) : 0;
    const noShowRate =
      eligible > 0 ? Math.round((row.noShow / eligible) * 100) : 0;
    return { avgCheck, noShowRate };
  }, [stats.data, doctorId]);
  const failed = finance.isError || stats.isError;

  const revenue = finance.data?.revenue ?? 0;
  const apptCount = finance.data?.appointments ?? 0;
  const bonus = finance.data?.bonus ?? 0;

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("period")}</p>
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-background p-0.5 text-xs">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={
                p === period
                  ? "rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground"
                  : "rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {tPeriod(p)}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <p role="alert" className="mb-3 text-xs text-destructive">
          {t("loadError")}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile
          label={t("revenue")}
          tone="primary"
          icon={<TrendingUpIcon className="size-4" />}
          value={
            finance.isError ? (
              "—"
            ) : (
              <MoneyText amount={revenue} currency="UZS" showDual={false} />
            )
          }
        />
        <KpiTile
          label={t("appointments")}
          tone="info"
          icon={<CalendarDaysIcon className="size-4" />}
          value={finance.isError ? "—" : apptCount}
        />
        <KpiTile
          label={t("avgCheck")}
          tone="success"
          icon={<BanknoteIcon className="size-4" />}
          value={
            stats.isError ? (
              "—"
            ) : (
              <MoneyText
                amount={extra.avgCheck}
                currency="UZS"
                showDual={false}
              />
            )
          }
        />
        <KpiTile
          label={t("noShow")}
          tone={extra.noShowRate > 20 ? "warning" : "neutral"}
          icon={<PercentIcon className="size-4" />}
          value={
            stats.isError ? "—" : t("noShowRate", { rate: extra.noShowRate })
          }
        />
      </div>

      <div className="mt-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("bonus")}:</span>{" "}
        <MoneyText amount={bonus} currency="UZS" />
      </div>
    </section>
  );
}
