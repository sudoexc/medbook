"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import { useDoctorSchedule } from "../_hooks/use-doctor-schedule";
import type { ScheduleType } from "../_hooks/use-doctor-today";

const TYPE_LABEL: Record<ScheduleType, string> = {
  consultation: "Консультация",
  repeat: "Повторный приём",
  reserve: "Резерв",
  break: "Обед",
};

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Headline label above the date — anchors "today" and "yesterday/tomorrow"
 * so the doctor can tell at a glance which day they're paging through
 * without re-reading the date string each time.
 */
function relativeLabel(view: Date, today: Date): string | null {
  const delta = daysBetween(view, today);
  if (delta === 0) return "Сегодня";
  if (delta === -1) return "Вчера";
  if (delta === 1) return "Завтра";
  return null;
}

function fullDateLabel(view: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(view);
}

export function ScheduleCard() {
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  const [viewDate, setViewDate] = React.useState<Date>(() => startOfDay(new Date()));
  const today = React.useMemo(() => startOfDay(new Date()), []);
  const isToday = daysBetween(viewDate, today) === 0;
  const dateKey = toIsoDate(viewDate);

  const { data, isLoading } = useDoctorSchedule(dateKey);
  const entries = data?.entries ?? [];

  const rel = relativeLabel(viewDate, today);
  const dateLine = fullDateLabel(viewDate);

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <div className="text-[15px] font-semibold text-foreground">
            {rel ? `${rel} · ${dateLine}` : dateLine}
          </div>
          <div className="text-xs text-muted-foreground">
            Расписание врача
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewDate(today)}
            disabled={isToday}
            className={cn(
              "motion-press inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium transition-colors",
              isToday
                ? "cursor-default text-muted-foreground opacity-60"
                : "text-foreground hover:bg-muted",
            )}
          >
            Сегодня
          </button>
          <button
            type="button"
            aria-label="Предыдущий день"
            onClick={() => setViewDate((d) => addDays(d, -1))}
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Следующий день"
            onClick={() => setViewDate((d) => addDays(d, 1))}
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRightIcon className="size-3.5" />
          </button>
        </div>
      </header>

      <ul className="flex-1 divide-y divide-border/60 px-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="size-2 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-4 w-12" />
            </li>
          ))
        ) : entries.length === 0 ? (
          <li className="px-5 py-10 text-center text-sm text-muted-foreground">
            {isToday ? "На сегодня записей нет" : "Записей на этот день нет"}
          </li>
        ) : (
          entries.slice(0, 6).map((entry) => {
            const isBreak = entry.type === "break";
            const isReserve = entry.type === "reserve";
            // Only highlight "active" appointments when viewing today —
            // the dot has no semantic meaning when paging through past
            // or future days.
            const active = isToday && entry.status === "in_progress";

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
                  ) : entry.status === "no_show" ? (
                    <span className="inline-flex items-center rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
                      Не пришёл
                    </span>
                  ) : entry.status === "cancelled" ? (
                    <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive">
                      Отменён
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
          })
        )}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <Link
          href={`/${locale}/doctor/schedule?date=${dateKey}`}
          className="motion-press inline-flex w-full items-center justify-center gap-2 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          <CalendarIcon className="size-4" />
          Показать весь день
          {entries.length > 6 ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold">
              +{entries.length - 6}
            </span>
          ) : null}
        </Link>
      </footer>
    </section>
  );
}
