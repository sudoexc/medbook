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
import { useDoctorAppointments } from "../_hooks/use-doctor-appointments";
import { usePeriodRange, type PeriodKey } from "../../_hooks/use-doctors-filters";

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
  const appts = useDoctorAppointments(doctorId, range);

  const extra = React.useMemo(() => {
    const rows = appts.data?.rows ?? [];
    let completed = 0;
    let noShow = 0;
    let revenue = 0;
    let eligible = 0;
    for (const r of rows) {
      if (
        r.status === "COMPLETED" ||
        r.status === "NO_SHOW" ||
        r.status === "CANCELLED"
      ) {
        eligible += 1;
      }
      if (r.status === "COMPLETED") {
        completed += 1;
        revenue += r.priceFinal ?? 0;
      }
      if (r.status === "NO_SHOW") noShow += 1;
    }
    const avgCheck = completed > 0 ? Math.round(revenue / completed) : 0;
    const noShowRate = eligible > 0 ? Math.round((noShow / eligible) * 100) : 0;
    return { avgCheck, noShowRate };
  }, [appts.data]);

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

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile
          label={t("revenue")}
          tone="primary"
          icon={<TrendingUpIcon className="size-4" />}
          value={
            <MoneyText amount={revenue} currency="UZS" showDual={false} />
          }
        />
        <KpiTile
          label={t("appointments")}
          tone="info"
          icon={<CalendarDaysIcon className="size-4" />}
          value={apptCount}
        />
        <KpiTile
          label={t("avgCheck")}
          tone="success"
          icon={<BanknoteIcon className="size-4" />}
          value={
            <MoneyText
              amount={extra.avgCheck}
              currency="UZS"
              showDual={false}
            />
          }
        />
        <KpiTile
          label={t("noShow")}
          tone={extra.noShowRate > 20 ? "warning" : "neutral"}
          icon={<PercentIcon className="size-4" />}
          value={t("noShowRate", { rate: extra.noShowRate })}
        />
      </div>

      <div className="mt-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("bonus")}:</span>{" "}
        <MoneyText amount={bonus} currency="UZS" />
      </div>
    </section>
  );
}
