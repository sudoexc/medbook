"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BellIcon,
  FilterIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import type { QueueRow } from "../_hooks/use-queue";
import type { TemplateChannel } from "../_hooks/types";

export type ChannelFilter = "all" | TemplateChannel;

const CHANNEL_ICON: Record<ChannelFilter, LucideIcon> = {
  all: FilterIcon,
  SMS: MessageSquareIcon,
  TG: SendIcon,
  EMAIL: MailIcon,
  CALL: PhoneIcon,
  VISIT: BellIcon,
};

const VISIBLE: ChannelFilter[] = ["all", "SMS", "TG", "EMAIL", "CALL"];

export function NotificationsTypesSidebar({
  rows,
  active,
  onChange,
  isLoading,
}: {
  rows: QueueRow[];
  active: ChannelFilter;
  onChange: (next: ChannelFilter) => void;
  isLoading: boolean;
}) {
  const t = useTranslations("notifications.types");

  const counts = React.useMemo(() => {
    const out: Record<ChannelFilter, number> = {
      all: rows.length,
      SMS: 0,
      TG: 0,
      EMAIL: 0,
      CALL: 0,
      VISIT: 0,
    };
    for (const r of rows) out[r.channel] += 1;
    return out;
  }, [rows]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t("subtitle")}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-2 p-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <ul className="grid gap-1">
            {VISIBLE.map((channel) => {
              const Icon = CHANNEL_ICON[channel];
              const count = counts[channel] ?? 0;
              const isActive = active === channel;
              return (
                <li key={channel}>
                  <button
                    type="button"
                    onClick={() => onChange(channel)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition",
                      isActive
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{t(`labels.${channel}`)}</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
