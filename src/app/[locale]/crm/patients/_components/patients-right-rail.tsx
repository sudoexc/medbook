"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRightIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  ClockIcon,
  PhoneIcon,
  SendIcon,
  SparklesIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { MoneyText } from "@/components/atoms/money-text";
import { Skeleton } from "@/components/ui/skeleton";

import { usePatientsStats } from "../_hooks/use-patients-stats";
import type { PatientRow } from "../_hooks/use-patients-list";

export interface PatientsRightRailProps {
  rows: PatientRow[];
}

type Tone = "primary" | "info" | "success" | "warning" | "danger";

const TONE_CLASS: Record<Tone, { icon: string; border: string; chip: string }> = {
  primary: {
    icon: "bg-primary/10 text-primary",
    border: "border-l-primary",
    chip: "bg-primary/10 text-primary",
  },
  info: {
    icon: "bg-[color:var(--info,#3b82f6)]/15 text-[color:var(--info,#3b82f6)]",
    border: "border-l-[color:var(--info,#3b82f6)]",
    chip: "bg-[color:var(--info,#3b82f6)]/15 text-[color:var(--info,#3b82f6)]",
  },
  success: {
    icon: "bg-[color:var(--success,#10b981)]/15 text-[color:var(--success,#10b981)]",
    border: "border-l-[color:var(--success,#10b981)]",
    chip: "bg-[color:var(--success,#10b981)]/15 text-[color:var(--success,#10b981)]",
  },
  warning: {
    icon: "bg-[color:var(--warning,#f59e0b)]/15 text-[color:var(--warning,#f59e0b)]",
    border: "border-l-[color:var(--warning,#f59e0b)]",
    chip: "bg-[color:var(--warning,#f59e0b)]/15 text-[color:var(--warning,#f59e0b)]",
  },
  danger: {
    icon: "bg-destructive/10 text-destructive",
    border: "border-l-destructive",
    chip: "bg-destructive/10 text-destructive",
  },
};

const SourcesWidget = dynamic(
  () => import("./sources-widget").then((m) => m.SourcesWidget),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl border border-border bg-card p-3">
        <Skeleton className="h-40 w-full" />
      </div>
    ),
  },
);

/**
 * Right rail for the patients list — docs/5 - Пациенты (2).png.
 *
 * Sections:
 *  - Центр действий (3 quick actions + "Смотреть все")
 *  - Сегменты (VIP / >30 дней / Новые / Потерянные)
 *  - Статистика за месяц (Новые / Вернувшиеся / Средний чек / Общий доход)
 *  - Источники пациентов (donut)
 */
export function PatientsRightRail({ rows }: PatientsRightRailProps) {
  const t = useTranslations("patients.rail");
  const locale = useLocale();
  const { data: stats, isLoading } = usePatientsStats();

  const segments = React.useMemo(() => {
    const count = {
      VIP: 0,
      DORMANT: 0,
      NEW: 0,
      CHURN: 0,
    };
    for (const p of rows) {
      if (p.segment === "VIP") count.VIP += 1;
      if (p.segment === "DORMANT") count.DORMANT += 1;
      if (p.segment === "NEW") count.NEW += 1;
      if (p.segment === "CHURN") count.CHURN += 1;
    }
    return count;
  }, [rows]);

  const actions: Array<{
    tone: Tone;
    icon: LucideIcon;
    title: string;
    subtitle: string;
    count: number;
  }> = [
    {
      tone: "primary",
      icon: PhoneIcon,
      title: t("actions.callTitle"),
      subtitle: t("actions.callSubtitle"),
      count: segments.DORMANT,
    },
    {
      tone: "info",
      icon: SendIcon,
      title: t("actions.telegramTitle"),
      subtitle: t("actions.telegramSubtitle"),
      count: segments.NEW,
    },
    {
      tone: "success",
      icon: CalendarClockIcon,
      title: t("actions.bookTitle"),
      subtitle: t("actions.bookSubtitle"),
      count: segments.VIP + segments.DORMANT,
    },
  ];

  const monthly = React.useMemo(() => {
    let ltvSum = 0;
    let ltvCount = 0;
    for (const p of rows) {
      if (p.ltv > 0) {
        ltvSum += p.ltv;
        ltvCount += 1;
      }
    }
    const avgCheck = ltvCount > 0 ? Math.round(ltvSum / ltvCount) : 0;
    return {
      newCount: segments.NEW,
      returning: rows.filter((p) => p.visitsCount > 1).length,
      avgCheck,
      totalRevenue: ltvSum,
    };
  }, [rows, segments]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      {/* Центр действий */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("actionsHeading")}
        </h3>
        <ul className="space-y-2">
          {actions.map((a) => {
            const tone = TONE_CLASS[a.tone];
            const Icon = a.icon;
            return (
              <li
                key={a.title}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 border-l-[3px] cursor-pointer hover:bg-muted/30",
                  tone.border,
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                    tone.icon,
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[12px] font-semibold text-foreground">
                      {a.title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-bold tabular-nums",
                        tone.chip.replace(/bg-[^\s]+\s?/, "").trim(),
                      )}
                    >
                      {a.count}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {a.subtitle}
                  </p>
                </div>
                <ChevronRightIcon className="size-3.5 text-muted-foreground" />
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-[12px] font-semibold text-primary hover:bg-primary/5"
        >
          {t("viewAllActions")}
          <ArrowRightIcon className="size-3.5" />
        </button>
      </section>

      {/* Сегменты */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("segmentsHeading")}
        </h3>
        <ul className="space-y-1.5">
          <SegmentRow
            icon={SparklesIcon}
            label={t("segments.vip")}
            count={segments.VIP}
            tone="info"
            locale={locale}
          />
          <SegmentRow
            icon={ClockIcon}
            label={t("segments.dormant30")}
            count={segments.DORMANT}
            tone="warning"
            locale={locale}
          />
          <SegmentRow
            icon={UsersIcon}
            label={t("segments.newClients")}
            count={segments.NEW}
            tone="success"
            locale={locale}
          />
          <SegmentRow
            icon={ClockIcon}
            label={t("segments.churn")}
            count={segments.CHURN}
            tone="danger"
            locale={locale}
          />
        </ul>
      </section>

      {/* Статистика */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("statsHeading")}
          </h3>
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("statsPeriod")}
          </span>
        </div>
        <div className="divide-y divide-border rounded-2xl border border-border bg-card">
          <StatsRow label={t("stats.newPatients")} value={monthly.newCount} />
          <StatsRow label={t("stats.returning")} value={monthly.returning} />
          <StatsRow
            label={t("stats.avgCheck")}
            value={
              monthly.avgCheck > 0 ? (
                <MoneyText amount={monthly.avgCheck} currency="UZS" />
              ) : (
                "—"
              )
            }
          />
          <StatsRow
            label={t("stats.totalRevenue")}
            value={
              monthly.totalRevenue > 0 ? (
                <MoneyText amount={monthly.totalRevenue} currency="UZS" />
              ) : (
                "—"
              )
            }
          />
        </div>
      </section>

      {/* Источники пациентов (donut) */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("sourcesHeading")}
        </h3>
        <SourcesWidget stats={stats} isLoading={isLoading} />
      </section>
    </div>
  );
}

function SegmentRow({
  icon: Icon,
  label,
  count,
  tone,
  locale,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  tone: Tone;
  locale: string;
}) {
  const toneClass = TONE_CLASS[tone];
  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 text-[12px]">
      <span
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
          toneClass.icon,
        )}
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
      <span className="truncate text-foreground">{label}</span>
      <span className="ml-auto tabular-nums font-semibold text-foreground">
        {new Intl.NumberFormat(locale === "uz" ? "uz-UZ" : "ru-RU").format(count)}
      </span>
    </li>
  );
}

function StatsRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}
