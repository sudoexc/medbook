"use client";

import { CheckCircle2Icon, SettingsIcon, SparklesIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_AI_KEY_FINDINGS, MOCK_AI_SUMMARY } from "../_mocks";

export function DocumentAiPanel() {
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center justify-between gap-2 border-b border-border">
        <div className="flex items-center gap-3">
          <TabButton active>AI-помощник</TabButton>
          <TabButton>Информация</TabButton>
        </div>
        <button
          type="button"
          aria-label="Настройки"
          className="mb-1 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <SettingsIcon className="size-4" />
        </button>
      </div>

      <div className="mt-4">
        <div className="text-sm font-semibold text-foreground">
          Краткое содержание
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {MOCK_AI_SUMMARY}
        </p>
      </div>

      <div className="mt-4">
        <div className="text-sm font-semibold text-foreground">
          Ключевые находки
        </div>
        <ul className="mt-2 space-y-2">
          {MOCK_AI_KEY_FINDINGS.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-foreground">
              <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span className="leading-relaxed">{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        className="motion-press mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <SparklesIcon className="size-4" />
        Сгенерировать полный анализ
      </button>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
        AI-ответы могут содержать неточности. Проверяйте информацию.
      </p>
    </section>
  );
}

function TabButton({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative py-2.5 text-sm transition-colors",
        active ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {active ? (
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
        />
      ) : null}
    </button>
  );
}
