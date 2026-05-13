"use client";

import {
  AlertTriangleIcon,
  CalendarOffIcon,
  CheckCircle2Icon,
  ChevronUpIcon,
  ClockIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_AI_RECOS, MOCK_AI_RECOS_TOTAL, type AiReco } from "../_mocks";

const ICONS: Record<AiReco["tone"], React.ComponentType<{ className?: string }>> = {
  danger: AlertTriangleIcon,
  warning: CalendarOffIcon,
  info: ClockIcon,
  success: CheckCircle2Icon,
};

const TONE: Record<AiReco["tone"], string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
};

export function AiAssistantPanel() {
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" />
          <span className="text-[15px] font-semibold text-foreground">
            AI-помощник
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Настройки помощника"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <SettingsIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Свернуть"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronUpIcon className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl bg-primary/5 px-3 py-2.5">
        <span className="text-xs font-semibold text-primary">
          Рекомендации на сегодня
        </span>
        <span className="inline-flex min-w-[24px] items-center justify-center rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
          {MOCK_AI_RECOS_TOTAL}
        </span>
      </div>

      <ul className="mt-3 space-y-1">
        {MOCK_AI_RECOS.map((r) => {
          const Icon = ICONS[r.tone];
          return (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md",
                    TONE[r.tone],
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="flex-1 text-xs text-foreground">{r.label}</span>
                <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                  {r.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-border bg-background py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
      >
        Показать всех
      </button>
    </section>
  );
}
