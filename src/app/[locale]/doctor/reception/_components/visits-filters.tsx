"use client";

import { CalendarIcon, ChevronDownIcon, RotateCcwIcon } from "lucide-react";

export function VisitsFilters() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        <CalendarIcon className="size-4 text-muted-foreground" />
        01.01.2024 – 13.05.2025
      </button>
      <FilterSelect label="Тип приёма" value="Все" />
      <FilterSelect label="Диагноз" value="Все" />
      <FilterSelect label="Врач" value="Все" />
      <button
        type="button"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <RotateCcwIcon className="size-3.5" />
        Сбросить
      </button>
    </div>
  );
}

function FilterSelect({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
      <ChevronDownIcon className="size-3.5 text-muted-foreground" />
    </button>
  );
}
