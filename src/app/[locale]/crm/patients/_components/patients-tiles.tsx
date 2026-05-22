"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ActivityIcon,
  ClockIcon,
  SparklesIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AnimatedMoney } from "@/components/motion/animated-money";
import { CountUp } from "@/components/atoms/count-up";

import type { PatientRow } from "../_hooks/use-patients-list";

export interface PatientsTilesProps {
  rows: PatientRow[];
  total: number | null;
  className?: string;
  activeKey?: string | null;
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

type DeltaTone = "success" | "muted" | "warning";

type Tile = {
  key: string;
  label: string;
  value: React.ReactNode;
  delta: string;
  deltaTone: DeltaTone;
  icon: LucideIcon;
  tone: Tone;
  href: string;
};

export function PatientsTiles({
  rows,
  total,
  className,
  activeKey,
}: PatientsTilesProps) {
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

  // Pre-computed last-7-day floor for the "new" tile drill-down.
  const newWeekFrom = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const tiles: Tile[] = [
    {
      key: "all",
      label: t("totalPatients"),
      value: <CountUp to={stats.totalAll} />,
      delta:
        stats.newWeek > 0
          ? t("deltaTotalPatients", { count: stats.newWeek })
          : "",
      deltaTone: "success",
      icon: UsersIcon,
      tone: "info",
      href: `/${locale}/crm/patients`,
    },
    {
      key: "new-week",
      label: t("newWeek"),
      value: <CountUp to={stats.newWeek} />,
      delta: "",
      deltaTone: "muted",
      icon: SparklesIcon,
      tone: "warning",
      href: `/${locale}/crm/patients/segments/new`,
    },
    {
      key: "active",
      label: t("active"),
      value: <CountUp to={stats.active} />,
      delta: t("deltaActivePct", { pct: stats.activePct }),
      deltaTone: "success",
      icon: ActivityIcon,
      tone: "success",
      href: `/${locale}/crm/patients/segments/active`,
    },
    {
      key: "dormant",
      label: t("dormantGt30"),
      value: <CountUp to={stats.dormantGt30} />,
      delta: t("deltaDormantPct", { pct: stats.dormantPct }),
      deltaTone: "muted",
      icon: ClockIcon,
      tone: "danger",
      href: `/${locale}/crm/patients/segments/dormant`,
    },
    {
      key: "avg-check",
      label: t("avgCheck"),
      value:
        stats.avgCheck > 0 ? (
          <AnimatedMoney amount={stats.avgCheck} currency="UZS" />
        ) : (
          "—"
        ),
      delta: "",
      deltaTone: "muted",
      icon: WalletIcon,
      tone: "info",
      href: `/${locale}/crm/analytics?period=month`,
    },
  ];
  void newWeekFrom;

  return (
    <div
      className={cn(
        "motion-stagger grid gap-2",
        "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5",
        className,
      )}
    >
      {tiles.map((tile) => {
        const Icon = tile.icon;
        const tone = TONE[tile.tone];
        const isActive = (activeKey ?? "all") === tile.key;
        return (
          <Link
            key={tile.key}
            href={tile.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "motion-rise-in motion-hover-lift motion-press flex items-center gap-3 rounded-2xl border bg-card p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              isActive
                ? "border-primary ring-1 ring-primary/40"
                : "border-border hover:border-primary/40",
            )}
          >
            <span
              className={cn(
                "inline-flex size-12 shrink-0 items-center justify-center rounded-xl",
                tone.bg,
                tone.fg,
              )}
              aria-hidden
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {tile.label}
              </div>
              <div className="mt-0.5 truncate text-2xl font-bold tabular-nums leading-tight text-foreground">
                {tile.value}
              </div>
              <div
                className={cn(
                  "min-h-4 truncate text-xs font-medium leading-tight",
                  tile.deltaTone === "success" && "text-success",
                  tile.deltaTone === "muted" && "text-muted-foreground",
                  tile.deltaTone === "warning" &&
                    "text-[color:var(--warning-foreground)]",
                )}
              >
                {tile.delta}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
