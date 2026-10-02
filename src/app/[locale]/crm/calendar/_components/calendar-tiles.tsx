"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
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
import { ARRIVED_STATUSES } from "@/lib/appointments/list-tiles";
import { atNoShowRisk } from "@/lib/appointments/overdue";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import { useTodayFreeSlots } from "../../appointments/_hooks/use-today-free-slots";
import type { DoctorResource } from "../_hooks/use-calendar-data";

/**
 * What the visible range is, for the first tile's label: «Записей сегодня»
 * only when the calendar shows today alone (audit AP-20: the week view
 * called its whole week «сегодня»).
 */
export type CalendarRangeKind = "today" | "day" | "range";

export interface CalendarTilesProps {
  appointments: AppointmentRow[];
  /** The visible range (end exclusive): what the tiles count and drill into. */
  range: { from: Date; to: Date };
  rangeKind: CalendarRangeKind;
  /** Active doctors, whose free slots today the last tile sums. */
  doctors: DoctorResource[];
  className?: string;
}

/** «Подтверждено»: confirmed, or already in the building or seen. */
const CONFIRMED_OR_ARRIVED: ReadonlySet<string> = new Set([
  "CONFIRMED",
  ...ARRIVED_STATUSES,
]);

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
  /** Optional drill-down URL — when present the tile renders as a Link. */
  href?: string;
};

export function CalendarTiles({
  appointments,
  range,
  rangeKind,
  doctors,
  className,
}: CalendarTilesProps) {
  const t = useTranslations("calendar.tiles");
  const locale = useLocale();
  // Single timestamp so tile counters remain stable across renders.
  const [now] = React.useState(() => Date.now());
  const stats = React.useMemo(() => {
    const total = appointments.length;
    // Audit AP-20: «Подтверждено» was IN_PROGRESS + COMPLETED, so a
    // CONFIRMED booking counted nowhere; the risk tile counted patients
    // sitting in the hall (WAITING).
    const confirmed = appointments.filter((a) =>
      CONFIRMED_OR_ARRIVED.has(a.status),
    ).length;
    const pending = appointments.filter((a) => a.status === "BOOKED").length;
    const cancelled = appointments.filter((a) => a.status === "CANCELLED").length;
    const risk = appointments.filter((a) => atNoShowRisk(a, now)).length;
    return {
      total,
      confirmed,
      pending,
      cancelled,
      risk,
      confirmedPct: total > 0 ? Math.round((confirmed / total) * 100) : 0,
      pendingPct: total > 0 ? Math.round((pending / total) * 100) : 0,
      riskPct: total > 0 ? Math.round((risk / total) * 100) : 0,
    };
  }, [appointments, now]);

  // Free slots today: the sum of what the SlotPicker offers per active
  // doctor, from his schedule (it was «(11 h minus every booking, cancelled
  // ones too) / 30» for all doctors together).
  const slotQueries = useTodayFreeSlots(
    doctors.filter((d) => d.isActive).map((d) => d.id),
  );
  const free = slotQueries.reduce((sum, q) => sum + (q.data?.length ?? 0), 0);

  const buildHref = React.useCallback(
    (bucket?: string) => {
      const sp = new URLSearchParams();
      // The drill-down opens the range the tiles count, not just its first
      // day (`to` is exclusive here, inclusive on «Записи»).
      sp.set("from", range.from.toISOString());
      sp.set("to", new Date(range.to.getTime() - 1).toISOString());
      sp.set("dateMode", "range");
      if (bucket) sp.set("bucket", bucket);
      return `/${locale}/crm/appointments?${sp.toString()}`;
    },
    [range, locale],
  );

  const tiles: Tile[] = [
    {
      key: "total",
      label:
        rangeKind === "today"
          ? t("total")
          : rangeKind === "day"
            ? t("totalDay")
            : t("totalRange"),
      value: stats.total,
      subtitle:
        stats.cancelled > 0
          ? t("totalSubtitleCancelled", { count: stats.cancelled })
          : undefined,
      icon: CalendarDaysIcon,
      tone: "info",
      href: buildHref(),
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
      // No drill-down: no «Записи» tile is «confirmed or arrived».
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
      href: buildHref("unconfirmed"),
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
      // No drill-down: «Срочные» on «Записи» is the hall plus the overdue,
      // the very patients this tile leaves out.
    },
    {
      key: "free",
      label: t("freeSlots"),
      value: free,
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
        const sharedClass = cn(
          "motion-rise-in motion-hover-lift flex items-center gap-3 rounded-2xl border border-border bg-card p-4",
          tile.href &&
            "motion-press cursor-pointer transition hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        );
        const inner = (
          <>
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
          </>
        );
        if (tile.href) {
          return (
            <Link
              key={tile.key}
              href={tile.href}
              className={sharedClass}
            >
              {inner}
            </Link>
          );
        }
        return (
          <div key={tile.key} className={sharedClass}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
