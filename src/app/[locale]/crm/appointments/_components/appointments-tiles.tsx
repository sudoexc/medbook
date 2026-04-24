"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  CalendarCheck2Icon,
  CheckCircle2Icon,
  ClockIcon,
  ShieldAlertIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { tallyBuckets, type AppointmentRow } from "../_hooks/use-appointments-list";

export interface AppointmentsTilesProps {
  rows: AppointmentRow[];
  total: number | null;
  className?: string;
}

type Tone = "neutral" | "danger" | "warning" | "purple" | "success";

type Tile = {
  key: string;
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone: Tone;
};

const TONE: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "bg-muted", fg: "text-foreground" },
  danger: { bg: "bg-destructive/10", fg: "text-destructive" },
  warning: { bg: "bg-warning/15", fg: "text-[color:var(--warning)]" },
  purple: { bg: "bg-info/10", fg: "text-[color:var(--info)]" },
  success: { bg: "bg-success/15", fg: "text-[color:var(--success)]" },
};

/**
 * Display-only stat tiles above the appointments table — per docs/2 - Записи
 * (2).png.
 *
 * Six cards: total, "сейчас важно", "скоро приём", "не подтверждены",
 * "опоздания", "пришли". Counts are derived from the already-loaded rows;
 * a server-side "whole filter set" total is still respected for `all`.
 */
export function AppointmentsTiles({
  rows,
  total,
  className,
}: AppointmentsTilesProps) {
  const t = useTranslations("appointments.tiles");
  const buckets = React.useMemo(() => tallyBuckets(rows), [rows]);

  const tiles: Tile[] = [
    {
      key: "all",
      label: t("all"),
      value: total ?? buckets.all,
      icon: CalendarCheck2Icon,
      tone: "purple",
    },
    {
      key: "needs_attention",
      label: t("needsAttention"),
      value: buckets.needsAttention,
      icon: UsersRoundIcon,
      tone: "danger",
    },
    {
      key: "soon",
      label: t("soon"),
      value: buckets.soon,
      icon: ClockIcon,
      tone: "warning",
    },
    {
      key: "unconfirmed",
      label: t("unconfirmed"),
      value: buckets.unconfirmed,
      icon: ShieldAlertIcon,
      tone: "purple",
    },
    {
      key: "late",
      label: t("late"),
      value: buckets.late,
      icon: ClockIcon,
      tone: "danger",
    },
    {
      key: "arrived",
      label: t("arrived"),
      value: buckets.arrived,
      icon: CheckCircle2Icon,
      tone: "success",
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
              <div
                className={cn(
                  "mt-0.5 text-xl font-bold tabular-nums leading-none",
                  tile.tone === "danger"
                    ? "text-destructive"
                    : "text-foreground",
                )}
              >
                {tile.value}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type { Tile as AppointmentsTileShape };
