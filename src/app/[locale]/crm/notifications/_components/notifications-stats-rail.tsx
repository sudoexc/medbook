"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  SparklesIcon,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

import { useNotificationsStats } from "../_hooks/use-queue";

type KpiProps = {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: "default" | "success" | "warning" | "destructive";
};

const TONE: Record<NonNullable<KpiProps["tone"]>, string> = {
  default: "bg-muted/50 text-foreground",
  success: "bg-success/10 text-[color:var(--success)]",
  warning: "bg-warning/20 text-[color:var(--warning-foreground)]",
  destructive: "bg-destructive/10 text-destructive",
};

function Kpi({ label, value, icon, tone = "default" }: KpiProps) {
  return (
    <div className={`flex items-center gap-3 rounded-lg p-3 ${TONE[tone]}`}>
      <div className="flex size-8 items-center justify-center rounded-full bg-background/60">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs opacity-80">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

export function NotificationsStatsRail() {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const { data, isLoading } = useNotificationsStats();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">{t("rail.today")}</h3>
        {isLoading ? (
          <div className="mt-2 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <Kpi
              label={t("rail.sentToday")}
              value={data?.today.sent ?? 0}
              icon={<CheckCircle2Icon className="size-4" />}
              tone="success"
            />
            <Kpi
              label={t("rail.queued")}
              value={data?.today.queued ?? 0}
              icon={<ClockIcon className="size-4" />}
              tone="warning"
            />
            <Kpi
              label={t("rail.failedToday")}
              value={data?.today.failed ?? 0}
              icon={<AlertTriangleIcon className="size-4" />}
              tone="destructive"
            />
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">{t("rail.last30d")}</h3>
        {isLoading ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : (
          <div className="mt-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground">{t("rail.total")}</span>
              <span className="font-semibold">{data?.last30d.total ?? 0}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground">{t("rail.delivered")}</span>
              <span className="font-semibold">
                {data?.last30d.delivered ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground">{t("rail.failed")}</span>
              <span className="font-semibold text-destructive">
                {data?.last30d.failed ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted-foreground">
                {t("rail.activeTemplates")}
              </span>
              <span className="font-semibold">{data?.activeTemplates ?? 0}</span>
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold">
          <SparklesIcon className="size-3.5" />
          {t("rail.topTemplates")}
        </h3>
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (data?.topTemplates ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            {t("rail.noTop")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {(data?.topTemplates ?? []).slice(0, 5).map((row) => (
              <li
                key={row.templateId ?? "manual"}
                className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-xs"
              >
                <span className="truncate">
                  {locale === "uz"
                    ? row.nameUz ?? t("rail.manual")
                    : row.nameRu ?? t("rail.manual")}
                </span>
                <span className="font-semibold tabular-nums">
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        {t("rail.devModeHint")}
      </div>
    </div>
  );
}
