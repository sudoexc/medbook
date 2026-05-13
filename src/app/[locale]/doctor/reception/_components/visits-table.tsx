"use client";

import {
  ArrowDownIcon,
  BarChart3Icon,
  ChevronDownIcon,
  FileTextIcon,
  InfoIcon,
  MoreVerticalIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_VISITS, type Visit } from "../_mocks";

const TYPE_BADGE: Record<Visit["type"], string> = {
  consultation: "bg-success/15 text-success",
  repeat: "bg-violet/15 text-violet",
};

const TYPE_LABEL: Record<Visit["type"], string> = {
  consultation: "Консультация",
  repeat: "Повторный приём",
};

export function VisitsTable() {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header row */}
      <div className="grid grid-cols-[120px_130px_minmax(0,200px)_minmax(0,1fr)_170px_150px_220px] gap-3 border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <div className="flex items-center gap-1">
          Дата и время
          <ArrowDownIcon className="size-3" />
        </div>
        <div>Тип приёма</div>
        <div>Диагноз</div>
        <div>Лечение и рекомендации</div>
        <div>Документы</div>
        <div>Врач</div>
        <div className="text-right">Действия</div>
      </div>

      {/* Rows */}
      <ul className="divide-y divide-border">
        {MOCK_VISITS.map((v) => (
          <li
            key={v.id}
            className="grid grid-cols-[120px_130px_minmax(0,200px)_minmax(0,1fr)_170px_150px_220px] items-start gap-3 px-5 py-4 transition-colors hover:bg-muted/30"
          >
            <div>
              <div className="text-sm font-semibold text-foreground tabular-nums">
                {v.date}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {v.timeStart} – {v.timeEnd}
              </div>
            </div>

            <div>
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-semibold",
                  TYPE_BADGE[v.type],
                )}
              >
                {TYPE_LABEL[v.type]}
              </span>
            </div>

            <div className="flex items-start gap-1.5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground tabular-nums">
                  {v.diagnosis.code}
                </div>
                <div className="text-xs text-muted-foreground">
                  {v.diagnosis.name}
                </div>
              </div>
              <button
                type="button"
                aria-label="Подробнее о диагнозе"
                className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <InfoIcon className="size-3.5" />
              </button>
            </div>

            <ul className="min-w-0 space-y-0.5 text-xs text-foreground">
              {v.treatments.map((t, i) => (
                <li key={i} className="truncate">
                  {t}
                </li>
              ))}
            </ul>

            <div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
              >
                <FileTextIcon
                  className={cn(
                    "size-4",
                    v.document.flagged ? "text-destructive" : "text-info",
                  )}
                />
                <div className="text-left">
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Заключение
                  </div>
                  <div className="font-medium text-foreground tabular-nums">
                    {v.document.filename.replace("Заключение ", "")}
                  </div>
                </div>
              </button>
            </div>

            <div>
              <div className="text-sm font-semibold text-foreground">
                {v.doctorName}
              </div>
              <div className="text-xs text-muted-foreground">
                {v.doctorSpecialty}
              </div>
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <BarChart3Icon className="size-3.5" />
                Сравнить
              </button>
              <button
                type="button"
                className="motion-press inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Открыть
              </button>
              <button
                type="button"
                aria-label="Ещё действия"
                className="flex h-9 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreVerticalIcon className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <button
          type="button"
          className="motion-press inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Показать ещё 2 визита
          <ChevronDownIcon className="size-4" />
        </button>
      </footer>
    </section>
  );
}
