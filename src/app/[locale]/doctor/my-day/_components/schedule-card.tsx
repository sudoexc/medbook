"use client";

import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_SCHEDULE, type ScheduleEntry } from "../_mocks";

const TYPE_LABEL: Record<ScheduleEntry["type"], string> = {
  consultation: "Консультация",
  repeat: "Повторный приём",
  reserve: "Резерв",
  break: "Обед",
};

export function ScheduleCard() {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <div className="text-[15px] font-semibold text-foreground">
            Расписание на сегодня
          </div>
          <div className="text-xs text-muted-foreground">13 мая, среда</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="motion-press inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            Сегодня
          </button>
          <button
            type="button"
            aria-label="Предыдущий день"
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Следующий день"
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRightIcon className="size-3.5" />
          </button>
        </div>
      </header>

      <ul className="flex-1 divide-y divide-border/60 px-2">
        {MOCK_SCHEDULE.map((entry) => {
          const isBreak = entry.type === "break";
          const isReserve = entry.type === "reserve";
          const active = entry.status === "in_progress";

          return (
            <li
              key={entry.id}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                active && "bg-primary/[0.04]",
                !active && !isBreak && "hover:bg-muted/50",
              )}
            >
              <div className="w-12 shrink-0 text-sm font-semibold tabular-nums text-foreground">
                {entry.startTime}
              </div>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    active
                      ? "bg-success ring-2 ring-success/30"
                      : isReserve
                        ? "border-2 border-warning"
                        : isBreak
                          ? "bg-muted-foreground/30"
                          : "border-2 border-border",
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "truncate text-sm font-semibold",
                    isBreak || isReserve
                      ? "text-muted-foreground"
                      : "text-foreground",
                  )}
                >
                  {entry.patientName ?? (isBreak ? "Обед" : "Не указано")}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {TYPE_LABEL[entry.type]}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {active ? (
                  <span className="inline-flex items-center rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">
                    Идёт приём
                  </span>
                ) : entry.durationMin ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {entry.durationMin} мин
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <button
          type="button"
          className="motion-press inline-flex w-full items-center justify-center gap-2 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          <CalendarIcon className="size-4" />
          Показать весь день
        </button>
      </footer>
    </section>
  );
}
