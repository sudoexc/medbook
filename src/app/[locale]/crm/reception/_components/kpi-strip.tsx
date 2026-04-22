"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ActivityIcon,
  BanknoteIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  HourglassIcon,
  XCircleIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
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
export function KpiStrip({ dashboard, todayRows, className }: KpiStripProps) {
  const t = useTranslations("reception.kpi");

  const today = dashboard?.today;
  const queue = dashboard?.queue;
  const totalToday = todayRows.length;
  const waiting = pickBucket(queue, "WAITING") + pickBucket(queue, "BOOKED");
  const inProgress = today?.inProgress ?? pickBucket(queue, "IN_PROGRESS");
  const completed = today?.completed ?? pickBucket(queue, "COMPLETED");
  const noShow = pickBucket(queue, "NO_SHOW");
  const revenue = today?.revenue ?? 0;

  const tiles = [
    {
      key: "today",
      href: "/crm/appointments?dateMode=today",
      label: t("todayAppointments"),
      value: <span className="tabular-nums">{totalToday}</span>,
      tone: "primary" as const,
      icon: <CalendarDaysIcon />,
    },
    {
      key: "waiting",
      href: "/crm/appointments?dateMode=today&bucket=waiting",
      label: t("waiting"),
      value: <span className="tabular-nums">{waiting}</span>,
      tone: "warning" as const,
      icon: <HourglassIcon />,
    },
    {
      key: "inProgress",
      href: "/crm/appointments?dateMode=today&bucket=in_progress",
      label: t("inProgress"),
      value: <span className="tabular-nums">{inProgress}</span>,
      tone: "info" as const,
      icon: <ActivityIcon />,
    },
    {
      key: "completed",
      href: "/crm/appointments?dateMode=today&bucket=completed",
      label: t("checkedIn"),
      value: <span className="tabular-nums">{completed}</span>,
      tone: "success" as const,
      icon: <CheckCircle2Icon />,
    },
    {
      key: "noShow",
      href: "/crm/appointments?dateMode=today&bucket=no_show",
      label: t("missed"),
      value: <span className="tabular-nums">{noShow}</span>,
      tone: "neutral" as const,
      icon: <XCircleIcon />,
    },
    {
      key: "revenue",
      href: "/crm/payments?period=today",
      label: t("revenue"),
      value: (
        <MoneyText
          amount={revenue}
          currency="UZS"
          className="tabular-nums"
        />
      ),
      tone: "violet" as const,
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
    >
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href={tile.href}
          className="rounded-xl transition-shadow hover:shadow-[0_2px_8px_rgba(15,23,42,.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <KpiTile
            label={tile.label}
            value={tile.value}
            tone={tile.tone}
            icon={tile.icon}
          />
        </Link>
      ))}
    </div>
  );
}
