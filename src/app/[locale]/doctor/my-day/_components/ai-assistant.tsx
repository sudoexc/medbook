"use client";

import { useTranslations } from "next-intl";
import {
  ChevronUpIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useDoctorToday,
  type DaySummary,
} from "../_hooks/use-doctor-today";

/**
 * No-AI-v1: alerts + recommendations are reserved for a future worker. This
 * card currently renders the numeric day summary (real counts) + the
 * placeholder ("AI-помощник готовится").
 */
export function AIAssistant() {
  const t = useTranslations("doctor.myDay");
  const { data: summary, isLoading } = useDoctorToday<DaySummary>(
    (d) => d.daySummary,
  );

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet text-white">
            <SparklesIcon className="size-3.5" />
          </span>
          <span className="text-[15px] font-semibold text-foreground">
            {t("ai.title")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("ai.settingsAria")}
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SettingsIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("ai.collapseAria")}
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronUpIcon className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="space-y-4 px-5 pb-4">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("ai.summaryTitle")}
          </div>
          {isLoading || !summary ? (
            <div className="space-y-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : (
            <dl className="space-y-1.5 text-sm">
              <SummaryRow
                label={t("ai.totalAppointments")}
                value={summary.totalAppointments}
              />
              <SummaryRow
                label={t("ai.consultations")}
                value={summary.consultations}
              />
              <SummaryRow
                label={t("ai.repeats")}
                value={summary.repeats}
              />
              <SummaryRow
                label={t("ai.completed")}
                value={summary.completedCount}
              />
              <SummaryRow
                label={t("ai.dayPlan")}
                value={`${summary.dayPlanPercent}%`}
                tone={summary.dayPlanPercent >= 100 ? "success" : undefined}
              />
            </dl>
          )}
        </div>

        <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-3.5 py-4 text-center">
          <div className="mx-auto mb-1.5 flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <SparklesIcon className="size-4" />
          </div>
          <div className="text-xs font-semibold text-foreground">
            {t("ai.comingSoon")}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {t("ai.comingSoonHint")}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "success";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm font-bold tabular-nums",
          tone === "success" ? "text-success" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
