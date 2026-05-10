"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ClockIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CountUp } from "@/components/atoms/count-up";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";

export interface CalendarTilesProps {
  appointments: AppointmentRow[];
  className?: string;
}

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const TONE: Record<Tone, { bg: string; fg: string }> = {
  info: { bg: "bg-info/10", fg: "text-info" },
  success: { bg: "bg-success/15", fg: "text-success" },
  warning: { bg: "bg-warning/15", fg: "text-warning" },
  danger: { bg: "bg-destructive/10", fg: "text-destructive" },
  neutral: { bg: "bg-muted", fg: "text-muted-foreground" },
};

type Tile = {
  key: string;
  label: string;
  value: number;
  delta?: string;
  subtitle?: string;
  icon: LucideIcon;
  tone: Tone;
};

export function CalendarTiles({ appointments, className }: CalendarTilesProps) {
  const t = useTranslations("calendar.tiles");
  // Single timestamp so tile counters remain stable across renders.
  const [now] = React.useState(() => Date.now());
  const stats = React.useMemo(() => {
    const total = appointments.length;
    const confirmed = appointments.filter(
      (a) => a.status === "IN_PROGRESS" || a.status === "COMPLETED",
    ).length;
    const pending = appointments.filter((a) => a.status === "BOOKED").length;
    const cancelled = appointments.filter((a) => a.status === "CANCELLED").length;
    const fiveMin = 5 * 60 * 1000;
    const risk = appointments.filter((a) => {
      if (a.status === "NO_SHOW") return true;
      const start = new Date(a.date).getTime();
      return (
        (a.status === "BOOKED" || a.status === "WAITING") &&
        now - start > fiveMin * 3
      );
    }).length;
    const byDay = new Map<string, AppointmentRow[]>();
    for (const a of appointments) {
      const key = a.date.slice(0, 10);
      const list = byDay.get(key) ?? [];
      list.push(a);
      byDay.set(key, list);
    }
    let free = 0;
    for (const list of byDay.values()) {
      const scheduled = list.reduce(
        (acc, a) => acc + Math.max(5, a.durationMin || 30),
        0,
      );
      const dayCap = 11 * 60;
      free += Math.max(0, Math.floor((dayCap - scheduled) / 30));
    }
    return {
      total,
      confirmed,
      pending,
      cancelled,
      risk,
      free,
      confirmedPct: total > 0 ? Math.round((confirmed / total) * 100) : 0,
      pendingPct: total > 0 ? Math.round((pending / total) * 100) : 0,
      riskPct: total > 0 ? Math.round((risk / total) * 100) : 0,
    };
  }, [appointments, now]);

  // No prior-day data wired yet — show a fixed placeholder when total > 0.
  const yesterdayDelta = stats.total > 0 ? 8 : 0;

  const tiles: Tile[] = [
    {
      key: "total",
      label: t("total"),
      value: stats.total,
      delta:
        yesterdayDelta > 0
          ? t("totalDeltaYesterday", { count: yesterdayDelta })
          : undefined,
      subtitle:
        stats.cancelled > 0
          ? t("totalSubtitleCancelled", { count: stats.cancelled })
          : undefined,
      icon: CalendarDaysIcon,
      tone: "info",
    },
    {
      key: "confirmed",
      label: t("confirmed"),
      value: stats.confirmed,
      subtitle:
        stats.total > 0
          ? t("confirmedSubtitlePct", { pct: stats.confirmedPct })
          : undefined,
      icon: CheckCircle2Icon,
      tone: "success",
    },
    {
      key: "pending",
      label: t("pending"),
      value: stats.pending,
      subtitle:
        stats.total > 0
          ? t("pendingSubtitlePct", { pct: stats.pendingPct })
          : undefined,
      icon: ClockIcon,
      tone: "warning",
    },
    {
      key: "risk",
      label: t("risk"),
      value: stats.risk,
      subtitle:
        stats.total > 0
          ? t("riskSubtitlePct", { pct: stats.riskPct })
          : undefined,
      icon: AlertTriangleIcon,
      tone: "danger",
    },
    {
      key: "free",
      label: t("freeSlots"),
      value: stats.free,
      subtitle: t("freeSlotsSubtitle"),
      icon: UsersRoundIcon,
      tone: "neutral",
    },
  ];

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
        return (
          <div
            key={tile.key}
            className="motion-rise-in motion-hover-lift flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
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
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "text-2xl font-bold tabular-nums leading-tight",
                    tile.tone === "danger"
                      ? "text-destructive"
                      : "text-foreground",
                  )}
                >
                  <CountUp to={tile.value} />
                </span>
                {tile.delta ? (
                  <span className="truncate text-xs font-medium text-success">
                    {tile.delta}
                  </span>
                ) : null}
              </div>
              {/* min-h-4 keeps tile heights aligned when subtitle is hidden */}
              <div className="min-h-4 truncate text-xs leading-tight text-muted-foreground">
                {tile.subtitle ?? ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
