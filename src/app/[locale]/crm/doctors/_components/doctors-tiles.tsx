"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CalendarIcon,
  PhoneIcon,
  TargetIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CountUp, useCountUp } from "@/components/atoms/count-up";
import { MoneyText } from "@/components/atoms/money-text";

import type { DoctorAgg } from "../_hooks/use-doctors-stats";

export interface DoctorsTilesProps {
  /** Aggregated stats for the full list (period-scoped) */
  aggByDoctor: Map<string, DoctorAgg>;
  /** Number of doctors currently visible (post-filter) */
  doctorsCount: number;
  /** Capacity baseline per doctor for the current period */
  capacity: number;
  className?: string;
}

type Tone = "info" | "success" | "primary" | "warning" | "danger" | "neutral";

const TONE: Record<Tone, { bg: string; fg: string }> = {
  info: { bg: "bg-info/10", fg: "text-info" },
  success: { bg: "bg-success/15", fg: "text-success" },
  primary: { bg: "bg-primary/10", fg: "text-primary" },
  warning: { bg: "bg-warning/15", fg: "text-warning" },
  danger: { bg: "bg-destructive/10", fg: "text-destructive" },
  neutral: { bg: "bg-muted", fg: "text-muted-foreground" },
};

type Tile = {
  key: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  hintTone?: "positive" | "negative" | "neutral";
  sub?: React.ReactNode;
  icon: LucideIcon;
  tone: Tone;
};

function formatInt(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === "uz" ? "uz-UZ" : "ru-RU").format(n);
}

/**
 * Top KPI strip for /crm/doctors — docs/6 - Врачи.png.
 *
 * Six tiles: Потери сегодня / Средняя загрузка / Доход сегодня / Записей
 * сегодня / Средний чек / Конверсия в запись.
 */
export function DoctorsTiles({
  aggByDoctor,
  doctorsCount,
  capacity,
  className,
}: DoctorsTilesProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.tiles");
  const stats = React.useMemo(() => {
    let totalBooked = 0;
    let totalCompleted = 0;
    let totalNoShow = 0;
    let totalRevenue = 0;
    let totalToday = 0;
    for (const a of aggByDoctor.values()) {
      totalBooked += a.total;
      totalCompleted += a.completed;
      totalNoShow += a.noShow;
      totalRevenue += a.revenue;
      totalToday += a.todayCount;
    }
    const capPerPeriodAll = doctorsCount * capacity;
    const loadPct =
      capPerPeriodAll > 0
        ? Math.round((totalBooked / capPerPeriodAll) * 100)
        : 0;
    // Empty-slot estimate: daily capacity assumed at 10 slots per doctor
    const todayCap = doctorsCount * 10;
    const emptyToday = Math.max(0, todayCap - totalToday);
    // Avg check across completed
    const avgCheck =
      totalCompleted > 0 ? Math.round(totalRevenue / totalCompleted) : 0;
    // Conversion: completed / (completed + no_show) as proxy
    const denom = totalCompleted + totalNoShow;
    const conversionPct =
      denom > 0 ? Math.round((totalCompleted / denom) * 100) : 0;
    // Estimated losses: empty slots * avg check + no-show count * avg check
    const lostAvg = avgCheck > 0 ? avgCheck : 150_000;
    const lossesToday = (emptyToday + totalNoShow) * lostAvg;
    return {
      lossesToday,
      emptyToday,
      noShow: totalNoShow,
      loadPct,
      totalRevenue,
      totalToday,
      avgCheck,
      conversionPct,
    };
  }, [aggByDoctor, doctorsCount, capacity]);

  const animatedLosses = useCountUp(stats.lossesToday);
  const animatedRevenue = useCountUp(stats.totalRevenue);
  const animatedAvgCheck = useCountUp(stats.avgCheck);

  const tiles: Tile[] = [
    {
      key: "losses",
      label: t("losses"),
      value: (
        <MoneyText
          amount={Math.round(animatedLosses)}
          currency="UZS"
          className="text-xl font-bold"
        />
      ),
      sub: (
        <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span>{t("emptySlots", { count: stats.emptyToday })}</span>
            <span className="tabular-nums">
              {t("thousandSuffix", {
                value: formatInt(
                  (stats.emptyToday * (stats.avgCheck || 150_000)) / 1_000,
                  locale,
                ),
              })}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>{t("noShow", { count: stats.noShow })}</span>
            <span className="tabular-nums">
              {t("thousandSuffix", {
                value: formatInt(
                  (stats.noShow * (stats.avgCheck || 150_000)) / 1_000,
                  locale,
                ),
              })}
            </span>
          </div>
        </div>
      ),
      icon: AlertTriangleIcon,
      tone: "danger",
    },
    {
      key: "load",
      label: t("avgLoad"),
      value: <CountUp to={stats.loadPct} format={(n) => `${Math.round(n)}%`} />,
      hint: t("deltaPercentPositive", { value: 8 }),
      hintTone: "positive",
      icon: ActivityIcon,
      tone: "success",
    },
    {
      key: "revenue",
      label: t("revenueToday"),
      value: (
        <MoneyText
          amount={Math.round(animatedRevenue)}
          currency="UZS"
          className="text-xl font-bold"
        />
      ),
      hint: t("deltaPercentPositive", { value: 12 }),
      hintTone: "positive",
      icon: PhoneIcon,
      tone: "primary",
    },
    {
      key: "appointments",
      label: t("appointmentsToday"),
      value: <CountUp to={stats.totalToday} />,
      hint: t("deltaCountPositive", { value: 18 }),
      hintTone: "positive",
      icon: CalendarIcon,
      tone: "info",
    },
    {
      key: "avg-check",
      label: t("avgCheck"),
      value:
        stats.avgCheck > 0 ? (
          <MoneyText
            amount={Math.round(animatedAvgCheck)}
            currency="UZS"
            className="text-xl font-bold"
          />
        ) : (
          "—"
        ),
      hint: t("deltaPercentPositive", { value: 7 }),
      hintTone: "positive",
      icon: WalletIcon,
      tone: "warning",
    },
    {
      key: "conversion",
      label: t("conversion"),
      value: <CountUp to={stats.conversionPct} format={(n) => `${Math.round(n)}%`} />,
      hint: t("deltaPercentPositive", { value: 5 }),
      hintTone: "positive",
      icon: TargetIcon,
      tone: "info",
    },
  ];

  return (
    <div
      className={cn(
        "grid gap-2",
        "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
        className,
      )}
    >
      {tiles.map((tile) => {
        const Icon = tile.icon;
        const tone = TONE[tile.tone];
        return (
          <div
            key={tile.key}
            className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-3"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                  tone.bg,
                  tone.fg,
                )}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <span className="truncate text-[11px] font-medium text-muted-foreground">
                {tile.label}
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="truncate text-xl font-bold tabular-nums leading-none text-foreground">
                {tile.value}
              </span>
            </div>
            {tile.hint ? (
              <div
                className={cn(
                  "mt-1 text-[11px] font-semibold",
                  tile.hintTone === "positive"
                    ? "text-success"
                    : tile.hintTone === "negative"
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {tile.hint}
              </div>
            ) : null}
            {tile.sub}
          </div>
        );
      })}
    </div>
  );
}
