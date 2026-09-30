"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ActivityIcon,
  ArrowRightIcon,
  MoonIcon,
  StarIcon,
  StethoscopeIcon,
  UserCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CountUp } from "@/components/atoms/count-up";
import { AnimatedPercent } from "@/components/motion/animated-percent";

import type { DoctorRow } from "../_hooks/use-doctors-list";
import type { DoctorStatus } from "./doctor-card";

export interface DoctorsStatsPanelProps {
  doctors: DoctorRow[];
  /** Live status of each active doctor (busy/free/off), same as the cards. */
  statuses: DoctorStatus[];
  /**
   * Today's clinic load from the schedule, the «Загрузка сегодня» tile's
   * number; null when nobody works today (DR-08).
   */
  clinicLoadPct: number | null;
  className?: string;
}

type Row = {
  key: string;
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone: string;
};

function avgRating(doctors: DoctorRow[]): { value: number; count: number } {
  let sum = 0;
  let n = 0;
  for (const d of doctors) {
    const r = typeof d.rating === "string" ? Number(d.rating) : d.rating;
    if (typeof r === "number" && Number.isFinite(r) && r > 0) {
      sum += r;
      n += 1;
    }
  }
  if (n === 0) return { value: 0, count: 0 };
  return { value: Math.round((sum / n) * 10) / 10, count: n };
}

export function DoctorsStatsPanel({
  doctors,
  statuses,
  clinicLoadPct,
  className,
}: DoctorsStatsPanelProps) {
  const t = useTranslations("crmDoctors.statsPanel");
  const locale = useLocale();

  const total = doctors.length;
  const onShift = statuses.filter((s) => s === "busy").length;
  const free = statuses.filter((s) => s === "free").length;
  const offShift = statuses.filter((s) => s === "off").length;

  const rating = React.useMemo(() => avgRating(doctors), [doctors]);

  const rows: Row[] = [
    {
      key: "total",
      label: t("total"),
      value: <CountUp to={total} className="tabular-nums" />,
      icon: UsersIcon,
      tone: "bg-muted text-muted-foreground",
    },
    {
      key: "onShift",
      label: t("onShift"),
      value: <CountUp to={onShift} className="tabular-nums" />,
      icon: StethoscopeIcon,
      tone: "bg-success/15 text-success",
    },
    {
      key: "free",
      label: t("free"),
      value: <CountUp to={free} className="tabular-nums" />,
      icon: UserCheckIcon,
      tone: "bg-muted text-muted-foreground",
    },
    {
      key: "off",
      label: t("offShift"),
      value: <CountUp to={offShift} className="tabular-nums" />,
      icon: MoonIcon,
      tone: "bg-muted text-muted-foreground",
    },
    {
      key: "load",
      label: t("clinicLoad"),
      value:
        clinicLoadPct === null ? (
          <span className="text-muted-foreground">{t("noData")}</span>
        ) : (
          <AnimatedPercent
            value={clinicLoadPct}
            decimals={0}
            fromHundred
            className="tabular-nums"
          />
        ),
      icon: ActivityIcon,
      tone: "bg-primary/10 text-primary",
    },
    {
      key: "rating",
      label: t("avgRating"),
      value:
        rating.count > 0 ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <StarIcon className="size-3.5 fill-warning text-warning" />
            {rating.value.toFixed(1)}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("ratingEmpty")}</span>
        ),
      icon: StarIcon,
      tone: "bg-warning/15 text-[color:var(--warning-foreground)]",
    },
  ];

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <h3 className="text-[13px] font-semibold text-foreground">{t("title")}</h3>

      <ul className="motion-stagger mt-3 divide-y divide-border">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <li
              key={r.key}
              className="motion-fade-in flex items-center justify-between gap-2 py-2.5 text-[12px]"
            >
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <span
                  className={cn(
                    "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
                    r.tone,
                  )}
                  aria-hidden
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="truncate">{r.label}</span>
              </span>
              <span className="shrink-0 font-semibold text-foreground">
                {r.value}
              </span>
            </li>
          );
        })}
      </ul>

      <Link
        href={`/${locale}/crm/doctors?view=all`}
        className="motion-press mt-2 inline-flex items-center justify-center gap-1 self-end text-[12px] font-semibold text-primary transition hover:text-primary/80 hover:gap-1.5"
      >
        {t("viewAll")}
        <ArrowRightIcon className="size-3.5" />
      </Link>
    </div>
  );
}
