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

import { usePatientsTiles } from "../_hooks/use-patients-stats";

export interface PatientsTilesProps {
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

/** One decimal, as the tiles always showed it. */
function pctOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

/**
 * KPI tiles of /crm/patients (audit PT-13). Every number comes from
 * /api/crm/patients/tiles, counted over the clinic's whole base: they used
 * to be counted from the rows the list had loaded so far and changed on
 * scroll. «Активные» and «Остывают» are the segments, so each tile matches
 * the tab and the page it opens.
 */
export function PatientsTiles({ className, activeKey }: PatientsTilesProps) {
  const t = useTranslations("patients.tiles");
  const locale = useLocale();
  const query = usePatientsTiles();
  const data = query.data;
  // Loading or failed: a dash, never a zero that reads as a real count.
  const count = (n: number | undefined) =>
    n === undefined ? "—" : <CountUp to={n} />;

  const avgCheck = data?.avgCheck;
  const avgCheckValue: React.ReactNode = !data
    ? "—"
    : avgCheck?.paymentsTracked && avgCheck.value !== null ? (
        <AnimatedMoney amount={avgCheck.value} currency="UZS" />
      ) : (
        <span className="text-base font-semibold text-muted-foreground">
          {t("noData")}
        </span>
      );

  const tiles: Tile[] = [
    {
      key: "all",
      label: t("totalPatients"),
      value: count(data?.total),
      delta:
        data && data.newThisWeek > 0
          ? t("deltaTotalPatients", { count: data.newThisWeek })
          : "",
      deltaTone: "success",
      icon: UsersIcon,
      tone: "info",
      href: `/${locale}/crm/patients`,
    },
    {
      key: "new-week",
      label: t("newWeek"),
      value: count(data?.newThisWeek),
      delta: "",
      deltaTone: "muted",
      icon: SparklesIcon,
      tone: "warning",
      href: `/${locale}/crm/patients/segments/new`,
    },
    {
      key: "active",
      label: t("active"),
      value: count(data?.active),
      delta: data
        ? t("deltaActivePct", { pct: pctOf(data.active, data.total) })
        : "",
      deltaTone: "success",
      icon: ActivityIcon,
      tone: "success",
      href: `/${locale}/crm/patients/segments/active`,
    },
    {
      key: "dormant",
      label: t("dormant"),
      value: count(data?.dormant),
      delta: data
        ? t("deltaDormantPct", { pct: pctOf(data.dormant, data.total) })
        : "",
      deltaTone: "muted",
      icon: ClockIcon,
      tone: "danger",
      href: `/${locale}/crm/patients/segments/dormant`,
    },
    // Money only for the roles the analytics shows it to (ADMIN, DOCTOR).
    ...(data && !avgCheck?.visible
      ? []
      : [
          {
            key: "avg-check",
            label: t("avgCheck"),
            value: avgCheckValue,
            delta:
              data && avgCheck && !avgCheck.paymentsTracked
                ? t("paymentsNotTracked")
                : "",
            deltaTone: "muted" as const,
            icon: WalletIcon,
            tone: "info" as const,
            href: `/${locale}/crm/analytics?period=month`,
          },
        ]),
  ];

  return (
    <div
      className={cn(
        "motion-stagger grid gap-2",
        "grid-cols-2 sm:grid-cols-3",
        tiles.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4",
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
