"use client";

import {
  AlertTriangleIcon,
  ChevronUpIcon,
  LightbulbIcon,
  SettingsIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MOCK_CODING,
  MOCK_CODING_TOTAL,
  MOCK_MISSING_DATA,
  MOCK_SMART_RECOS,
  type CodingTone,
} from "../_mocks";

const TONE_BADGE: Record<CodingTone, string> = {
  primary: "bg-success/15 text-success",
  secondary: "bg-warning/15 text-warning",
  possible: "bg-info/15 text-info",
};

const TONE_LABEL: Record<CodingTone, string> = {
  primary: "Основной",
  secondary: "Сопутствующий",
  possible: "Возможный",
};

export function AiRail() {
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-3 xl:flex">
      {/* Header */}
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2">
            <SparklesIcon className="size-4 text-primary" />
            <span className="text-[15px] font-semibold text-foreground">
              AI-помощник
            </span>
            <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
              beta
            </span>
          </div>
          <div className="flex items-center gap-1">
            <IconBtn aria="Настройки">
              <SettingsIcon className="size-4" />
            </IconBtn>
            <IconBtn aria="Свернуть">
              <ChevronUpIcon className="size-4" />
            </IconBtn>
          </div>
        </div>

        {/* Coding suggestions */}
        <Group label="Предложения по кодированию" first />
        <ul className="space-y-2">
          {MOCK_CODING.map((c) => (
            <li
              key={c.code}
              className="flex items-start justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground tabular-nums">
                  {c.code}
                </div>
                <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {c.name}
                </div>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[10px] font-semibold",
                  TONE_BADGE[c.tone],
                )}
              >
                {TONE_LABEL[c.tone]}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-primary transition-colors hover:underline"
        >
          Показать все коды ({MOCK_CODING_TOTAL})
        </button>

        {/* Missing data */}
        <Group label="Недостающие данные" />
        <ul className="space-y-2">
          {MOCK_MISSING_DATA.map((m, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-foreground">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span className="leading-relaxed">{m}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-primary transition-colors hover:underline"
        >
          Отметить как заполненные
        </button>

        {/* Smart recos */}
        <Group label="Умные рекомендации" />
        <ul className="space-y-2">
          {MOCK_SMART_RECOS.map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-info/10 text-info">
                <LightbulbIcon className="size-3.5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">
                  {r.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.description}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-primary transition-colors hover:underline"
        >
          Показать все рекомендации
        </button>
      </section>

      {/* Generate text CTA */}
      <section className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-foreground">
            Сгенерировать текст
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Создайте раздел заключения на основе введённых данных
        </p>
        <button
          type="button"
          className="motion-press mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <SparklesIcon className="size-4 text-primary" />
          Сгенерировать раздел
        </button>
      </section>
    </aside>
  );
}

function Group({ label, first }: { label: string; first?: boolean }) {
  return (
    <div
      className={cn(
        "text-sm font-semibold text-foreground",
        first ? "mb-2 mt-4" : "mb-2 mt-5",
      )}
    >
      {label}
    </div>
  );
}

function IconBtn({
  aria,
  children,
}: {
  aria: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
