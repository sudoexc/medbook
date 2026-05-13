"use client";

import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_PAGINATION } from "../_mocks";

export function PatientsPagination() {
  const p = MOCK_PAGINATION;
  const pages: (number | "…")[] = [1, 2, 3, 4, 5, "…", p.totalPages];

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-3">
      <div className="text-xs text-muted-foreground tabular-nums">
        Показано {p.rangeFrom}–{p.rangeTo} из{" "}
        {p.total.toLocaleString("ru-RU").replace(",", " ")} пациентов
      </div>

      <nav className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Предыдущая страница"
          className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
        </button>

        {pages.map((pg, i) =>
          pg === "…" ? (
            <span
              key={`dots-${i}`}
              className="flex size-8 items-center justify-center text-sm text-muted-foreground"
            >
              …
            </span>
          ) : (
            <button
              key={pg}
              type="button"
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-sm tabular-nums transition-colors",
                pg === p.currentPage
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-foreground hover:bg-muted",
              )}
            >
              {pg}
            </button>
          ),
        )}

        <button
          type="button"
          aria-label="Следующая страница"
          className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </nav>

      <button
        type="button"
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors hover:bg-muted"
      >
        <span className="tabular-nums">{p.pageSize}</span> на странице
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </button>
    </section>
  );
}
