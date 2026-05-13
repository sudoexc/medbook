"use client";

import {
  CalendarIcon,
  ChevronDownIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react";

const SELECTS = [
  { label: "Тип документа" },
  { label: "Пациент" },
  { label: "Теги" },
  { label: "Статус" },
] as const;

export function DocumentsFilters() {
  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[260px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Поиск по названию, пациенту, номеру исследования..."
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </label>

        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted"
        >
          <CalendarIcon className="size-4 text-muted-foreground" />
          Период: Все время
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </button>

        {SELECTS.map((s) => (
          <button
            key={s.label}
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted"
          >
            {s.label}
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </button>
        ))}

        <button
          type="button"
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
        >
          <RotateCcwIcon className="size-3.5" />
          Сбросить
        </button>
      </div>
    </section>
  );
}
