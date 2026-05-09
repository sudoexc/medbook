"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ActivityIcon,
  BanknoteIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  Users2Icon,
  XCircleIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CountUp, useCountUp } from "@/components/atoms/count-up";
import { KpiTile } from "@/components/atoms/kpi-tile";
import { MoneyText } from "@/components/atoms/money-text";
import type {
  DashboardResponse,
  DashboardQueueBucket,
} from "../_hooks/use-reception-live";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";

export interface KpiStripProps {
  dashboard: DashboardResponse | undefined;
  todayRows: AppointmentRow[];
  /** Total active doctors — used for the "% busy" cabinet subtitle. */
  totalDoctors?: number;
  className?: string;
}

function pickBucket(
  buckets: DashboardQueueBucket[] | undefined,
  status: DashboardQueueBucket["status"],
): number {
  if (!buckets) return 0;
  for (const b of buckets) {
    if (b.status === status) return b.count;
  }
  return 0;
}

/**
 * 6 KPI tiles per TZ §6.1.2:
 *  - Total today, In progress, Waiting, Completed, No-show, Revenue.
 *
 * Each tile links to `/crm/appointments` pre-filtered on status so the
 * receptionist can drill into the list.
 */
export function KpiStrip({
  dashboard,
  todayRows,
  totalDoctors = 0,
  className,
}: KpiStripProps) {
  const t = useTranslations("reception.kpi");

  const today = dashboard?.today;
  const queue = dashboard?.queue;
  const totalToday = todayRows.length;
  const waiting = pickBucket(queue, "WAITING") + pickBucket(queue, "BOOKED");
  const inProgress = today?.inProgress ?? pickBucket(queue, "IN_PROGRESS");
  const completed = today?.completed ?? pickBucket(queue, "COMPLETED");
  const noShow = pickBucket(queue, "NO_SHOW");
  const revenue = today?.revenue ?? 0;
  const animatedRevenue = useCountUp(Number(revenue));

  const inProgressPct =
    totalDoctors > 0 ? Math.round((inProgress / totalDoctors) * 100) : null;
  const completedPct =
    totalToday > 0 ? Math.round((completed / totalToday) * 100) : null;
  const noShowPct =
    totalToday > 0 ? Math.round((noShow / totalToday) * 100) : null;

  const tiles = [
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
      href: "/crm/appointments?dateMode=today&bucket=waiting",
      label: t("waiting"),
      value: <CountUp to={waiting} className="tabular-nums" />,
      unit: t("unitPersons"),
      subtitle: t("subtitleWaitingQueue"),
      tone: "warning" as const,
      icon: <Users2Icon />,
    },
    {
      key: "inProgress",
      href: "/crm/appointments?dateMode=today&bucket=in_progress",
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
      key: "completed",
      href: "/crm/appointments?dateMode=today&bucket=completed",
      label: t("checkedIn"),
      value: <CountUp to={completed} className="tabular-nums" />,
      unit: t("unitPatients"),
      subtitle:
        completedPct !== null
          ? t("subtitlePctOfBookings", { pct: completedPct })
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
    {
      key: "revenue",
      href: "/crm/payments?period=today",
      label: t("revenue"),
      value: (
        <MoneyText
          amount={Math.round(animatedRevenue)}
          currency="UZS"
          className="tabular-nums"
        />
      ),
      unit: t("unitMoney"),
      tone: "success" as const,
      icon: <BanknoteIcon />,
    },
  ];

  return (
    <div
      className={cn(
        "grid gap-3",
        "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
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
          className="block h-full rounded-xl transition-shadow hover:shadow-[0_2px_8px_rgba(15,23,42,.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <KpiTile
            label={tile.label}
            value={tile.value}
            unit={tile.unit}
            subtitle={tile.subtitle}
            tone={tile.tone}
            icon={tile.icon}
          />
        </Link>
      ))}
    </div>
  );
}
