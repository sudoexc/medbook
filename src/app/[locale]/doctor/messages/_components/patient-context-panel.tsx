"use client";

import {
  BellIcon,
  CalendarIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  InfoIcon,
  MessageSquareIcon,
  PillIcon,
  SparklesIcon,
  StethoscopeIcon,
  TagIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  MOCK_AI_QUICK_REPLIES,
  MOCK_PATIENT_CONTEXT,
} from "../_mocks";

const QR_ICON: Record<string, LucideIcon> = {
  "qr-1": MessageSquareIcon,
  "qr-2": BellIcon,
  "qr-3": InfoIcon,
};

export function PatientContextPanel() {
  const ctx = MOCK_PATIENT_CONTEXT;
  return (
    <aside className="hidden w-[320px] shrink-0 flex-col gap-3 xl:flex">
      {/* Context group */}
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-4">
        <header className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2">
            <TagIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">
              Контекст пациента
            </span>
          </div>
          <button
            type="button"
            aria-label="Свернуть"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronUpIcon className="size-4" />
          </button>
        </header>

        <ContextCard
          Icon={CalendarIcon}
          title="Последний визит"
          actionLabel="Открыть визит"
        >
          <div className="text-sm font-semibold text-foreground tabular-nums">
            {ctx.lastVisit.date}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {ctx.lastVisit.meta}
          </div>
        </ContextCard>

        <ContextCard
          Icon={StethoscopeIcon}
          title="Последний диагноз"
          actionLabel="Открыть диагноз"
        >
          <div className="text-sm text-foreground">
            <span className="font-bold tabular-nums">{ctx.lastDiagnosis.code}</span>{" "}
            <span>{ctx.lastDiagnosis.name}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {ctx.lastDiagnosis.meta}
          </div>
        </ContextCard>

        <ContextCard
          Icon={PillIcon}
          title="Текущее лечение"
          actionLabel="Открыть назначения"
        >
          <ul className="space-y-0.5 text-sm">
            {ctx.treatment.map((t) => (
              <li key={t.name}>
                <span className="font-semibold text-foreground">{t.name}</span>
                <span className="text-muted-foreground"> — {t.dose}</span>
              </li>
            ))}
          </ul>
        </ContextCard>
      </section>

      {/* AI quick replies */}
      <section className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-4">
        <header className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            ИИ-помощник: быстрые ответы
          </span>
        </header>

        <ul className="mt-3 space-y-2">
          {MOCK_AI_QUICK_REPLIES.map((r) => {
            const Icon = QR_ICON[r.id]!;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="group flex w-full items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-foreground">
                      {r.title}
                    </div>
                    <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {r.description}
                    </div>
                  </div>
                  <ChevronRightIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                </button>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="mt-3 inline-flex w-full items-center justify-center gap-1 text-sm font-semibold text-primary transition-colors hover:underline"
        >
          Показать ещё
          <ChevronUpIcon className="size-3.5 rotate-180" />
        </button>
      </section>

      {/* Disclaimer */}
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        <span className="inline-flex size-4 -mb-0.5 mr-1 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <InfoIcon className="size-3" />
        </span>
        ИИ-помощник использует данные пациента и историю визитов для генерации ответов.
      </p>
    </aside>
  );
}

function ContextCard({
  Icon,
  title,
  actionLabel,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  actionLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-background/40 px-3 py-3")}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">{title}</span>
      </div>
      <div className="mt-2">{children}</div>
      <button
        type="button"
        className="mt-2 inline-flex items-center text-xs font-semibold text-primary transition-colors hover:underline"
      >
        {actionLabel}
      </button>
    </div>
  );
}
