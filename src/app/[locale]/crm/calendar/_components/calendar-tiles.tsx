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

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";

export interface CalendarTilesProps {
  appointments: AppointmentRow[];
  className?: string;
}

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const TONE: Record<Tone, { bg: string; fg: string }> = {
  info: { bg: "bg-info/10", fg: "text-[color:var(--info)]" },
  success: { bg: "bg-success/15", fg: "text-[color:var(--success)]" },
  warning: { bg: "bg-warning/15", fg: "text-[color:var(--warning)]" },
  danger: { bg: "bg-destructive/10", fg: "text-destructive" },
  neutral: { bg: "bg-muted", fg: "text-muted-foreground" },
};

/**
 * 5 quick-stat tiles for the calendar — docs/3 - Календарь записей (2).png.
 *
 * Layout: icon square + label + big number + optional subtitle/delta.
 */
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
    const fiveMin = 5 * 60 * 1000;
    const risk = appointments.filter((a) => {
      if (a.status === "NO_SHOW") return true;
      const start = new Date(a.date).getTime();
      return (
        (a.status === "BOOKED" || a.status === "WAITING") &&
        now - start > fiveMin * 3
      );
    }).length;
    // Free slots — 30-min gaps between scheduled today (rough heuristic).
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
      risk,
      free,
      confirmedPct: total > 0 ? Math.round((confirmed / total) * 100) : 0,
      pendingPct: total > 0 ? Math.round((pending / total) * 100) : 0,
    };
  }, [appointments, now]);

  const tiles: Array<{
    key: string;
    label: string;
    value: number | string;
    hint?: string;
    icon: LucideIcon;
    tone: Tone;
  }> = [
    {
      key: "total",
      label: t("total"),
      value: stats.total,
      hint: stats.total > 0 ? t("totalHint") : undefined,
      icon: CalendarDaysIcon,
      tone: "info",
    },
    {
      key: "confirmed",
      label: t("confirmed"),
      value: stats.confirmed,
      hint: stats.total > 0 ? `${stats.confirmedPct}%` : undefined,
      icon: CheckCircle2Icon,
      tone: "success",
    },
    {
      key: "pending",
      label: t("pending"),
      value: stats.pending,
      hint: stats.total > 0 ? `${stats.pendingPct}%` : undefined,
      icon: ClockIcon,
      tone: "warning",
    },
    {
      key: "risk",
      label: t("risk"),
      value: stats.risk,
      hint: stats.risk > 0 ? t("riskDetails") : undefined,
      icon: AlertTriangleIcon,
      tone: "danger",
    },
    {
      key: "free",
      label: t("freeSlots"),
      value: stats.free,
      hint: t("freeSlotsHint"),
      icon: UsersRoundIcon,
      tone: "neutral",
    },
  ];

  return (
    <div
      className={cn(
        "grid gap-2",
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
            className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-3"
          >
            <span
              className={cn(
                "inline-flex size-10 shrink-0 items-center justify-center rounded-lg",
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
                <span
                  className={cn(
                    "text-xl font-bold tabular-nums leading-none",
                    tile.tone === "danger"
                      ? "text-destructive"
                      : "text-foreground",
                  )}
                >
                  {tile.value}
                </span>
                {tile.hint ? (
                  <span className="truncate text-[11px] font-medium text-muted-foreground">
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
