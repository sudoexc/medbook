"use client";

import { useTranslations } from "next-intl";
import {
  PhoneCallIcon,
  PhoneIncomingIcon,
  PhoneMissedIcon,
  PhoneOutgoingIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { CallRow, DerivedCallStatus } from "../_hooks/types";
import { deriveStatus } from "../_hooks/types";

/**
 * One row in the queue or history list. Kept generic — the caller decides
 * whether it's clickable (`onClick`), highlighted (`selected`), or compact
 * (`dense`).
 *
 * Renders:
 *   [icon] full name / phone         [status pill]
 *          operator · hh:mm · dur
 */
export function CallBubble({
  row,
  onClick,
  selected,
  dense,
}: {
  row: CallRow;
  onClick?: () => void;
  selected?: boolean;
  dense?: boolean;
}) {
  const t = useTranslations("callCenter.status");
  const tBubble = useTranslations("callCenter.bubble");
  const status = deriveStatus(row);

  const Icon =
    status === "missed"
      ? PhoneMissedIcon
      : row.direction === "OUT"
      ? PhoneOutgoingIcon
      : status === "answered"
      ? PhoneCallIcon
      : PhoneIncomingIcon;

  const phone = row.direction === "OUT" ? row.toNumber : row.fromNumber;
  const name = row.patient?.fullName ?? tBubble("unknownCaller");
  const timeLabel = formatLocalTime(row.createdAt);
  const durationLabel = formatDuration(row.durationSec, row.createdAt, row.endedAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition-colors",
        onClick ? "hover:bg-muted" : "cursor-default",
        selected ? "border-primary/30 bg-primary/10" : "",
        dense ? "py-1.5" : "",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          statusChipClass(status, true),
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          {row.patient ? (
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
              {tBubble("linked")}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{phone}</span>
          <span aria-hidden>·</span>
          <span>{timeLabel}</span>
          {durationLabel ? (
            <>
              <span aria-hidden>·</span>
              <span>{durationLabel}</span>
            </>
          ) : null}
        </span>
      </span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-medium",
          statusChipClass(status, false),
        )}
      >
        {t(status)}
      </span>
    </button>
  );
}

function statusChipClass(status: DerivedCallStatus, solid: boolean): string {
  if (solid) {
    if (status === "ringing") return "bg-primary/15 text-primary";
    if (status === "answered") return "bg-success/15 text-success";
    if (status === "missed") return "bg-destructive/15 text-destructive";
    return "bg-muted text-muted-foreground";
  }
  if (status === "ringing")
    return "bg-primary/10 text-primary";
  if (status === "answered")
    return "bg-success/10 text-success";
  if (status === "missed") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(
  durationSec: number | null,
  createdAt: string,
  endedAt: string | null,
): string {
  if (durationSec != null) return formatDurationSec(durationSec);
  if (!endedAt) return "";
  const start = new Date(createdAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  return formatDurationSec(Math.round((end - start) / 1000));
}

function formatDurationSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
