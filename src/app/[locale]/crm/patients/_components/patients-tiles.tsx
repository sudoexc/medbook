"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ClockIcon,
  SparklesIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { MoneyText } from "@/components/atoms/money-text";

import type { PatientRow } from "../_hooks/use-patients-list";

export interface PatientsTilesProps {
  rows: PatientRow[];
  total: number | null;
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
  icon: LucideIcon;
  tone: Tone;
};

/**
 * 6 KPI tiles above the patients table — docs/5 - Пациенты (2).png.
 *
 * Layout: icon square + label + big number + delta chip.
 * Counts derive from the loaded rows and server-side total where available.
 */
export function PatientsTiles({ rows, total, className }: PatientsTilesProps) {
  const t = useTranslations("patients.tiles");
  const locale = useLocale();
  const [now] = React.useState(() => Date.now());
  const stats = React.useMemo(() => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    let newWeek = 0;
    let active = 0;
    let dormantGt30 = 0;
    let ltvSum = 0;
    let ltvCount = 0;
    for (const p of rows) {
      const created = new Date(p.createdAt).getTime();
      if (Number.isFinite(created) && now - created < sevenDaysMs) newWeek += 1;
      if (p.segment === "ACTIVE" || p.segment === "VIP") active += 1;
      const lastVisit = p.lastVisitAt
        ? new Date(p.lastVisitAt).getTime()
        : null;
      if (lastVisit !== null && now - lastVisit > thirtyDaysMs) dormantGt30 += 1;
      if (p.ltv > 0) {
        ltvSum += p.ltv;
        ltvCount += 1;
      }
    }
    const totalAll = total ?? rows.length;
    const activePct = totalAll > 0 ? Math.round((active / totalAll) * 1000) / 10 : 0;
    const dormantPct =
      totalAll > 0 ? Math.round((dormantGt30 / totalAll) * 1000) / 10 : 0;
    const avgCheck = ltvCount > 0 ? Math.round(ltvSum / ltvCount) : 0;
    return {
      totalAll,
      newWeek,
      active,
      activePct,
      dormantGt30,
      dormantPct,
      avgCheck,
    };
  }, [rows, total, now]);

  const tiles: Tile[] = [
    {
      key: "all",
      label: t("totalPatients"),
      value: formatInt(stats.totalAll, locale),
      hint:
        stats.newWeek > 0
          ? t("newWeekHint", { count: stats.newWeek })
          : undefined,
      hintTone: "positive",
      icon: UsersIcon,
      tone: "info",
    },
    {
      key: "new-week",
      label: t("newWeek"),
      value: stats.newWeek,
      hint: undefined,
      icon: SparklesIcon,
      tone: "primary",
    },
    {
      key: "active",
      label: t("active"),
      value: formatInt(stats.active, locale),
      hint: `${stats.activePct}%`,
      hintTone: "neutral",
      icon: ActivityIcon,
      tone: "success",
    },
    {
      key: "dormant",
      label: t("dormantGt30"),
      value: formatInt(stats.dormantGt30, locale),
      hint: `${stats.dormantPct}%`,
      hintTone: "neutral",
      icon: ClockIcon,
      tone: "warning",
    },
    {
      key: "risk",
      label: t("noShowRisk"),
      value: "—",
      hint: undefined,
      icon: AlertTriangleIcon,
      tone: "danger",
    },
    {
      key: "avg-check",
      label: t("avgCheck"),
      value:
        stats.avgCheck > 0 ? (
          <MoneyText amount={stats.avgCheck} currency="UZS" />
        ) : (
          "—"
        ),
      hint: undefined,
      icon: WalletIcon,
      tone: "primary",
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
            className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-3"
          >
            <span
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                tone.bg,
                tone.fg,
              )}
              aria-hidden
            >
              <Icon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium text-muted-foreground">
                {tile.label}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="truncate text-xl font-bold tabular-nums leading-none text-foreground">
                  {tile.value}
                </span>
                {tile.hint ? (
                  <span
                    className={cn(
                      "truncate text-[11px] font-medium",
                      tile.hintTone === "positive"
                        ? "text-success"
                        : tile.hintTone === "negative"
                          ? "text-destructive"
                          : "text-muted-foreground",
                    )}
                  >
                    {tile.hint}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatInt(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === "uz" ? "uz-UZ" : "ru-RU").format(n);
}
