"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { UsersIcon, SendHorizonalIcon, BanIcon, UserXIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTelegramStats } from "../_hooks/use-tg-stats";

type Tone = "info" | "success" | "destructive" | "warning";

const TONE_CLASS: Record<Tone, string> = {
  info: "border-info/30 bg-info/5 text-info",
  success: "border-success/30 bg-success/5 text-success",
  destructive: "border-destructive/30 bg-destructive/5 text-destructive",
  warning: "border-warning/30 bg-warning/5 text-warning",
};

function StatCard({
  icon,
  value,
  label,
  tone,
  badge,
  loading,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone: Tone;
  badge?: string;
  loading: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3.5 py-2.5",
        TONE_CLASS[tone],
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background/60">
        {icon}
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-1.5">
          <span className="text-xl font-semibold tabular-nums text-foreground">
            {loading ? "—" : value}
          </span>
          {badge ? (
            <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-success">
              {badge}
            </span>
          ) : null}
        </div>
        <span className="truncate text-[11px] leading-tight text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

export function TelegramStatsBar() {
  const t = useTranslations("tgInbox.stats");
  const { data, isLoading } = useTelegramStats();

  const newBadge =
    data && data.newLast7d > 0 ? t("newBadge", { count: data.newLast7d }) : undefined;

  return (
    <div className="flex shrink-0 items-stretch gap-2 border-b border-border/60 bg-card px-3 py-2.5">
      <StatCard
        icon={<UsersIcon className="size-4" aria-hidden />}
        value={data?.totalInTelegram ?? 0}
        label={t("total")}
        tone="info"
        badge={newBadge}
        loading={isLoading}
      />
      <StatCard
        icon={<SendHorizonalIcon className="size-4" aria-hidden />}
        value={data?.reachable ?? 0}
        label={t("reachable")}
        tone="success"
        loading={isLoading}
      />
      <StatCard
        icon={<BanIcon className="size-4" aria-hidden />}
        value={data?.blocked ?? 0}
        label={t("blocked")}
        tone="destructive"
        loading={isLoading}
      />
      <StatCard
        icon={<UserXIcon className="size-4" aria-hidden />}
        value={data?.optedOut ?? 0}
        label={t("optedOut")}
        tone="warning"
        loading={isLoading}
      />
    </div>
  );
}
