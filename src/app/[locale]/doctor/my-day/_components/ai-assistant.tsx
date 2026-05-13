"use client";

import {
  AlertTriangleIcon,
  CalendarClockIcon,
  ChevronUpIcon,
  SettingsIcon,
  SparklesIcon,
  TrendingUpIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MOCK_AI_ALERTS,
  MOCK_AI_RECOMMENDATIONS,
  MOCK_AI_SUMMARY,
  type AIRecommendation,
} from "../_mocks";

const RECO_ICON: Record<AIRecommendation["icon"], LucideIcon> = {
  calendar: CalendarClockIcon,
  trend: TrendingUpIcon,
};

export function AIAssistant() {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet text-white">
            <SparklesIcon className="size-3.5" />
          </span>
          <span className="text-[15px] font-semibold text-foreground">
            AI-помощник
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Настройки AI"
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SettingsIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Свернуть"
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronUpIcon className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="space-y-4 px-5 pb-4">
        {/* Сводка на сегодня */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Сводка на сегодня
          </div>
          <dl className="space-y-1.5 text-sm">
            <SummaryRow label="Всего приёмов" value={MOCK_AI_SUMMARY.totalAppointments} />
            <SummaryRow label="Консультаций" value={MOCK_AI_SUMMARY.consultations} />
            <SummaryRow label="Повторных приёмов" value={MOCK_AI_SUMMARY.repeats} />
            <SummaryRow
              label="План на день"
              value={`${MOCK_AI_SUMMARY.dayPlanPercent}%`}
              tone="success"
            />
          </dl>
        </div>

        {/* Активные алерты */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Активные алерты
          </div>
          <ul className="space-y-2">
            {MOCK_AI_ALERTS.map((a) => (
              <li
                key={a.id}
                className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2"
              >
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground">
                    {a.title}
                  </div>
                  {a.description ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {a.description}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Рекомендации */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Рекомендации
          </div>
          <ul className="space-y-2">
            {MOCK_AI_RECOMMENDATIONS.map((r) => {
              const Icon = RECO_ICON[r.icon];
              return (
                <li
                  key={r.id}
                  className="flex gap-2.5 rounded-lg border border-info/30 bg-info/5 px-3 py-2"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-info" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">
                      {r.title}
                    </div>
                    {r.description ? (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {r.description}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <button
          type="button"
          className="motion-press inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/5 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          <SparklesIcon className="size-4" />
          Открыть полный анализ дня
        </button>
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
