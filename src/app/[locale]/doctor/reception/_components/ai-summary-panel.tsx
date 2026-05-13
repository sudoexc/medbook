"use client";

import {
  CheckCircle2Icon,
  ChevronUpIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";

import { MOCK_AI_SUMMARY, MOCK_KEY_TRENDS } from "../_mocks";

export function AISummaryPanel() {
  return (
    <section className="rounded-2xl border border-border bg-card">
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
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            AI-сводка истории пациента
          </div>
          <div className="mt-1.5 space-y-2 text-xs leading-relaxed text-foreground">
            {MOCK_AI_SUMMARY.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ключевые тенденции
          </div>
          <ul className="space-y-1.5">
            {MOCK_KEY_TRENDS.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <CheckCircle2Icon className="size-4 shrink-0 text-success" />
                <span className="text-foreground">{t.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          className="motion-press inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/5 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          <SparklesIcon className="size-4" />
          Сформировать заключение
        </button>
      </div>
    </section>
  );
}
