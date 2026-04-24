"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BuildingIcon,
  GlobeIcon,
  PhoneIcon,
  RotateCcwIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface CalendarLegendProps {
  className?: string;
}

type StatusKey =
  | "BOOKED"
  | "WAITING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "BREAK"
  | "FREE";

const STATUS_SWATCHES: Array<{ key: StatusKey; dotClass: string }> = [
  { key: "BOOKED", dotClass: "bg-[color:var(--info,#3b82f6)]" },
  { key: "WAITING", dotClass: "bg-[color:var(--warning,#f59e0b)]" },
  { key: "IN_PROGRESS", dotClass: "bg-primary" },
  { key: "COMPLETED", dotClass: "bg-[color:var(--success,#10b981)]" },
  { key: "CANCELLED", dotClass: "bg-destructive" },
  { key: "NO_SHOW", dotClass: "bg-muted-foreground" },
  { key: "BREAK", dotClass: "bg-muted" },
  { key: "FREE", dotClass: "bg-background border border-dashed border-border" },
];

type ChannelKey = "CALL" | "TELEGRAM" | "SITE" | "WALKIN" | "REPEAT";

const CHANNELS: Array<{ key: ChannelKey; icon: LucideIcon }> = [
  { key: "CALL", icon: PhoneIcon },
  { key: "TELEGRAM", icon: SendIcon },
  { key: "SITE", icon: GlobeIcon },
  { key: "WALKIN", icon: BuildingIcon },
  { key: "REPEAT", icon: RotateCcwIcon },
];

/**
 * Horizontal legend below the calendar grid — docs/3 - Календарь записей (2).png.
 *
 * Two rows: status dots + channel icons.
 */
export function CalendarLegend({ className }: CalendarLegendProps) {
  const tStatus = useTranslations("calendar.legend.status");
  const tChannel = useTranslations("calendar.legend.channels");
  return (
    <div
      className={cn(
        "shrink-0 border-t border-border bg-card/40 px-4 py-2.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
        {STATUS_SWATCHES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block size-2.5 rounded", s.dotClass)} />
            <span>{tStatus(s.key)}</span>
          </span>
        ))}
        <span className="mx-1 inline-block h-3.5 w-px bg-border" aria-hidden />
        {CHANNELS.map((c) => {
          const Icon = c.icon;
          return (
            <span key={c.key} className="inline-flex items-center gap-1.5">
              <Icon className="size-3.5" />
              <span>{tChannel(c.key)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
