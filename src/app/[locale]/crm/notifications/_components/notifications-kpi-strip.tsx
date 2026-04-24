"use client";

import { useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  MailCheckIcon,
  type LucideIcon,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useNotificationsStats } from "../_hooks/use-queue";

type Tone = "success" | "warning" | "info" | "destructive";

type TileDef = {
  key: "sent" | "delivered" | "queued" | "failed";
  icon: LucideIcon;
  tone: Tone;
};

const TONE_CLASS: Record<Tone, string> = {
  success:
    "bg-[color:var(--success,#10b981)]/10 text-[color:var(--success,#10b981)]",
  warning: "bg-[color:var(--warning,#f59e0b)]/10 text-[color:var(--warning,#f59e0b)]",
  info: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
};

const TILES: TileDef[] = [
  { key: "sent", icon: CheckCircle2Icon, tone: "success" },
  { key: "delivered", icon: MailCheckIcon, tone: "info" },
  { key: "queued", icon: ClockIcon, tone: "warning" },
  { key: "failed", icon: AlertTriangleIcon, tone: "destructive" },
];

export function NotificationsKpiStrip() {
  const t = useTranslations("notifications.kpiStrip");
  const { data, isLoading } = useNotificationsStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {TILES.map((tile) => (
          <Skeleton key={tile.key} className="h-[72px] rounded-xl" />
        ))}
      </div>
    );
  }

  const values: Record<TileDef["key"], number> = {
    sent: data?.today.sent ?? 0,
    delivered: data?.last30d.delivered ?? 0,
    queued: data?.today.queued ?? 0,
    failed: data?.today.failed ?? 0,
  };

  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      {TILES.map((tile) => {
        const Icon = tile.icon;
        return (
          <div
            key={tile.key}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <div
              className={cn(
                "flex size-9 items-center justify-center rounded-full",
                TONE_CLASS[tile.tone],
              )}
              aria-hidden
            >
              <Icon className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t(`${tile.key}.label`)}
              </div>
              <div className="text-xl font-bold tabular-nums leading-tight">
                {values[tile.key]}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {t(`${tile.key}.hint`)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
