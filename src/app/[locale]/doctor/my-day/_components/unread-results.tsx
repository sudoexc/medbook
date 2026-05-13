"use client";

import { ArrowRightIcon, FileTextIcon } from "lucide-react";

import { MOCK_UNREAD_RESULTS } from "../_mocks";

export function UnreadResults() {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Непрочитанные результаты
        </div>
      </header>

      <ul className="space-y-1 px-3 pb-2">
        {MOCK_UNREAD_RESULTS.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
                <FileTextIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {r.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {r.patientShort}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-muted-foreground tabular-nums">
                  {r.date}
                </div>
                {r.isNew ? (
                  <span className="mt-1 inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                    новый
                  </span>
                ) : null}
              </div>
            </button>
          </li>
        ))}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <button
          type="button"
          className="motion-press inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Показать все результаты
          <ArrowRightIcon className="size-4" />
        </button>
      </footer>
    </section>
  );
}
