"use client";

import { useTranslations } from "next-intl";
import { ChevronUpIcon, ClipboardListIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useDoctorToday,
  type DaySummary,
} from "../_hooks/use-doctor-today";

/**
 * No-AI-v1: alerts + recommendations are reserved for a future worker. This
 * card renders the numeric day summary (real counts).
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
          <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ClipboardListIcon className="size-3.5" />
          </span>
          <span className="text-[15px] font-semibold text-foreground">
            {t("ai.summaryTitle")}
          </span>
        </div>
        <button
          type="button"
          aria-label={t("ai.collapseAria")}
          className="motion-press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronUpIcon className="size-3.5" />
        </button>
      </header>

      <div className="space-y-4 px-5 pb-4">
        <div>
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
