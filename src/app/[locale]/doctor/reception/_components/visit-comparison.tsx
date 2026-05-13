"use client";

import { BarChart3Icon } from "lucide-react";

export function VisitComparison() {
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-2 text-[15px] font-semibold text-foreground">
        Сравнение визитов
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Выберите 2—4 визита для сравнения динамики состояния пациента.
      </p>
      <button
        type="button"
        className="motion-press mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
      >
        <BarChart3Icon className="size-4" />
        Выбрать визиты
      </button>
    </section>
  );
}
