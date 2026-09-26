"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  BanknoteIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  Users2Icon,
  XCircleIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CountUp, useCountUp } from "@/components/atoms/count-up";
import { KpiTile, type KpiTileProps } from "@/components/atoms/kpi-tile";
import { MoneyText } from "@/components/atoms/money-text";
import {
  canSeeClinicRevenue,
  receptionQueueKpis,
} from "@/lib/reception-kpi";
import type { DashboardResponse } from "../_hooks/use-reception-live";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import { useCurrentRole } from "../../patients/[id]/_hooks/use-current-role";

export interface KpiStripProps {
  dashboard: DashboardResponse | undefined;
  /** Today's rows (the real clinic day, never the doctors panel's pick). */
  todayRows: AppointmentRow[];
  /** Total active doctors — used for the "% busy" cabinet subtitle. */
  totalDoctors?: number;
  className?: string;
}

interface StripTile {
  key: string;
  href: string;
  label: string;
  value: React.ReactNode;
  unit?: string;
  subtitle?: string;
  tone: KpiTileProps["tone"];
  icon: React.ReactNode;
}

/**
 * KPI tiles per TZ §6.1.2: total today, waiting now, in progress, arrived,
 * no-show, and revenue for the roles that may see it (see
 * `receptionQueueKpis` / `canSeeClinicRevenue`, audit UX-02).
 *
 * Each tile links to a surface every role here can open: the appointments
 * list, the side drawer, or (revenue, admins only) the financial dashboard.
 */
export function KpiStrip({
  dashboard,
  todayRows,
  totalDoctors = 0,
  className,
}: KpiStripProps) {
  const t = useTranslations("reception.kpi");
  const showRevenue = canSeeClinicRevenue(useCurrentRole());

  const totalToday = todayRows.length;
  const { waitingNow, arrived, inProgress, noShow } = receptionQueueKpis(
    dashboard?.queue,
  );
  const revenue = dashboard?.today.revenue ?? 0;
  const animatedRevenue = useCountUp(Number(revenue));

  const inProgressPct =
    totalDoctors > 0 ? Math.round((inProgress / totalDoctors) * 100) : null;
  const arrivedPct =
    totalToday > 0 ? Math.round((arrived / totalToday) * 100) : null;
  const noShowPct =
    totalToday > 0 ? Math.round((noShow / totalToday) * 100) : null;

  const tiles: StripTile[] = [
    {
      key: "today",
      href: "/crm/appointments?dateMode=today",
      label: t("todayAppointments"),
      value: <CountUp to={totalToday} className="tabular-nums" />,
      unit: t("unitPatients"),
      tone: "primary" as const,
      icon: <CalendarDaysIcon />,
    },
    {
      key: "waiting",
      href: "?panel=queue",
      label: t("waiting"),
      value: <CountUp to={waitingNow} className="tabular-nums" />,
      unit: t("unitPersons"),
      subtitle: t("subtitleWaitingQueue"),
      tone: "warning" as const,
      icon: <Users2Icon />,
    },
    {
      key: "inProgress",
      href: "?panel=in_progress",
      label: t("inProgress"),
      value: <CountUp to={inProgress} className="tabular-nums" />,
      unit: t("unitRooms"),
      subtitle:
        inProgressPct !== null
          ? t("subtitlePctBusy", { pct: inProgressPct })
          : undefined,
      tone: "success" as const,
      icon: <ActivityIcon />,
    },
    {
      key: "arrived",
      // Today's full list: arrivals span several statuses and no single
      // status bucket of the appointments page matches this count.
      href: "/crm/appointments?dateMode=today",
      label: t("checkedIn"),
      value: <CountUp to={arrived} className="tabular-nums" />,
      unit: t("unitPatients"),
      subtitle:
        arrivedPct !== null
          ? t("subtitlePctOfBookings", { pct: arrivedPct })
          : undefined,
      tone: "violet" as const,
      icon: <CheckCircle2Icon />,
    },
    {
      key: "noShow",
      href: "/crm/appointments?dateMode=today&bucket=no_show",
      label: t("missed"),
      value: <CountUp to={noShow} className="tabular-nums" />,
      unit: t("unitPatients"),
      subtitle:
        noShowPct !== null
          ? t("subtitlePctOfBookings", { pct: noShowPct })
          : undefined,
      tone: "pink" as const,
      icon: <XCircleIcon />,
    },
    ...(showRevenue
      ? [
          {
            key: "revenue",
            href: "/crm/analytics/financial",
            label: t("revenue"),
            // MoneyText already ends in «сум»: no separate unit, or the tile
            // read «1 500 000 сум сум».
            value: (
              <MoneyText
                amount={Math.round(animatedRevenue)}
                currency="UZS"
                className="tabular-nums"
              />
            ),
            tone: "success" as const,
            icon: <BanknoteIcon />,
          },
        ]
      : []),
  ];

  return (
    <div
      className={cn(
        "grid gap-3",
        "grid-cols-2 md:grid-cols-3",
        tiles.length > 5 ? "xl:grid-cols-6" : "xl:grid-cols-5",
        className,
      )}
      aria-live="polite"
      aria-atomic="false"
      aria-label={t("todayAppointments")}
    >
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href={tile.href}
          scroll={tile.href.startsWith("?") ? false : undefined}
          aria-label={`${tile.label} — ${t("openDetails")}`}
          className={cn(
            "group relative block h-full rounded-xl",
            "transition-[transform,box-shadow,border-color] duration-200 ease-out",
            "hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_rgba(15,23,42,0.18)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2",
            "active:translate-y-0",
            // Inner card border highlights on hover via descendant selector.
            "[&_[data-kpi-card]]:transition-colors [&_[data-kpi-card]]:duration-200",
            "hover:[&_[data-kpi-card]]:border-primary/35",
          )}
        >
          <KpiTile
            label={tile.label}
            value={tile.value}
            unit={tile.unit}
            subtitle={tile.subtitle}
            tone={tile.tone}
            icon={tile.icon}
          />
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute right-3 top-3 inline-flex size-5 items-center justify-center rounded-md",
              "bg-muted/60 text-muted-foreground opacity-0",
              "transition-[opacity,transform,background-color,color] duration-200 ease-out",
              "group-hover:opacity-100 group-hover:bg-primary/12 group-hover:text-primary",
              "group-focus-visible:opacity-100",
            )}
          >
            <ArrowUpRightIcon className="size-3" />
          </span>
        </Link>
      ))}
    </div>
  );
}
