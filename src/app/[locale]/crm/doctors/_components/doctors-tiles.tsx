"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CalendarIcon,
  TargetIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CountUp, useCountUp } from "@/components/atoms/count-up";
import { MoneyText } from "@/components/atoms/money-text";

import type { DoctorAgg, DoctorsTodayData } from "../_hooks/use-doctors-stats";

export interface DoctorsTilesProps {
  /** Aggregated stats for the full list (period-scoped) */
  aggByDoctor: Map<string, DoctorAgg>;
  /** Today's clinic totals from the schedule (DR-08); null while loading. */
  today: DoctorsTodayData["clinic"] | null;
  /** Period stats failed to load: show «—», never zeros that look real (DR-01). */
  unavailable?: boolean;
  /** Today's numbers failed to load. */
  todayUnavailable?: boolean;
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
  /** Each tile drills into the most relevant surface for the metric. */
  href: string;
  /** Which load the tile depends on, for the «—» of a failed load. */
  source: "period" | "today";
};

/**
 * Top KPI strip for /crm/doctors — docs/6 - Врачи.png.
 *
 * Six tiles, each labelled with what it really counts (audit DR-08):
 *   Неявки за период       no-shows of the period;
 *   Загрузка сегодня       booked minutes / working minutes by the schedule;
 *   Выручка за период      completed visits of the period (stats.ts);
 *   Записей сегодня        today's visits that hold the doctor's time;
 *   Средний чек за период  revenue / completed visits;
 *   Явка на приём          completed / (completed + no-shows).
 * The old «Потери сегодня» multiplied a fixed 10-slot capacity by a
 * made-up 150 000 сум fallback and showed tiins as thousands; «Доход
 * сегодня» showed the period. A number that cannot be computed reads «нет
 * данных», never a zero or a guess.
 */
export function DoctorsTiles({
  aggByDoctor,
  today,
  unavailable = false,
  todayUnavailable = false,
  className,
}: DoctorsTilesProps) {
  const locale = useLocale();
  const t = useTranslations("crmDoctors.tiles");
  const stats = React.useMemo(() => {
    let totalCompleted = 0;
    let totalNoShow = 0;
    let totalRevenue = 0;
    for (const a of aggByDoctor.values()) {
      totalCompleted += a.completed;
      totalNoShow += a.noShow;
      totalRevenue += a.revenue;
    }
    const avgCheck =
      totalCompleted > 0 ? Math.round(totalRevenue / totalCompleted) : null;
    // Attendance: of the visits that were due and are settled, how many
    // took place. Nothing settled yet: no rate.
    const denom = totalCompleted + totalNoShow;
    const attendancePct =
      denom > 0 ? Math.round((totalCompleted / denom) * 100) : null;
    return { totalNoShow, totalRevenue, avgCheck, attendancePct };
  }, [aggByDoctor]);

  const animatedRevenue = useCountUp(stats.totalRevenue);
  const animatedAvgCheck = useCountUp(stats.avgCheck ?? 0);

  const noData = (
    <span className="text-base font-semibold text-muted-foreground">
      {t("noData")}
    </span>
  );

  const tiles: Tile[] = [
    {
      key: "no-show",
      label: t("noShowPeriod"),
      value: <CountUp to={stats.totalNoShow} />,
      icon: AlertTriangleIcon,
      tone: "danger",
      href: `/${locale}/crm/analytics/loss`,
      source: "period",
    },
    {
      key: "load",
      label: t("loadToday"),
      value: !today ? (
        "—"
      ) : today.loadPct === null ? (
        noData
      ) : (
        <CountUp to={today.loadPct} format={(n) => `${Math.round(n)}%`} />
      ),
      icon: ActivityIcon,
      tone: "success",
      href: `/${locale}/crm/analytics/schedule-heatmap`,
      source: "today",
    },
    {
      key: "revenue",
      label: t("revenuePeriod"),
      value: (
        <MoneyText
          amount={Math.round(animatedRevenue)}
          currency="UZS"
          className="text-xl font-bold"
        />
      ),
      icon: WalletIcon,
      tone: "primary",
      href: `/${locale}/crm/analytics/financial`,
      source: "period",
    },
    {
      key: "appointments",
      label: t("appointmentsToday"),
      value: today ? <CountUp to={today.booked} /> : "—",
      icon: CalendarIcon,
      tone: "info",
      href: `/${locale}/crm/appointments?dateMode=today`,
      source: "today",
    },
    {
      key: "avg-check",
      label: t("avgCheckPeriod"),
      value:
        stats.avgCheck !== null ? (
          <MoneyText
            amount={Math.round(animatedAvgCheck)}
            currency="UZS"
            className="text-xl font-bold"
          />
        ) : (
          noData
        ),
      icon: WalletIcon,
      tone: "warning",
      href: `/${locale}/crm/analytics/financial`,
      source: "period",
    },
    {
      key: "attendance",
      label: t("attendance"),
      value:
        stats.attendancePct !== null ? (
          <CountUp to={stats.attendancePct} format={(n) => `${Math.round(n)}%`} />
        ) : (
          noData
        ),
      icon: TargetIcon,
      tone: "info",
      href: `/${locale}/crm/analytics/cohorts`,
      source: "period",
    },
  ];

  const shown: Tile[] = tiles.map((tile) =>
    (tile.source === "period" && unavailable) ||
    (tile.source === "today" && todayUnavailable)
      ? { ...tile, value: "—", hint: undefined, sub: undefined }
      : tile,
  );

  return (
    <div
      className={cn(
        "grid gap-2",
        "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
        className,
      )}
    >
      {shown.map((tile) => {
        const Icon = tile.icon;
        const tone = TONE[tile.tone];
        return (
          <Link
            key={tile.key}
            href={tile.href}
            className="motion-press motion-hover-lift flex min-w-0 flex-col rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/30"
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
          </Link>
        );
      })}
    </div>
  );
}
