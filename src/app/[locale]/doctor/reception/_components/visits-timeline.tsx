"use client";

import { ChevronLeftIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_TIMELINE, MOCK_VISITS_TOTAL } from "../_mocks";

export function VisitsTimeline() {
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-4 text-[15px] font-semibold text-foreground">
        Лента визитов
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label="Прокрутить назад"
          className="motion-press flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
        </button>

        <div className="relative min-w-0 flex-1">
          {/* Connector — passes through the vertical centre of the dots */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-2 h-px bg-border"
          />
          <ul className="relative grid auto-cols-fr grid-flow-col">
            {MOCK_TIMELINE.map((p) => (
              <li
                key={p.id}
                className="flex flex-col items-center text-center"
              >
                <div className="relative z-10 mb-3 flex h-4 items-center justify-center">
                  <span
                    aria-hidden
                    className={cn(
                      "block rounded-full",
                      p.current
                        ? "size-4 bg-success ring-4 ring-success/20"
                        : "size-3 bg-primary",
                    )}
                  />
                </div>
                <div className="text-sm font-semibold text-foreground tabular-nums">
                  {p.date}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {p.type}
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.doctorShort}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          className="flex shrink-0 flex-col items-end gap-0.5 self-start pt-1"
        >
          <span className="text-xs font-semibold text-primary hover:underline">
            Все визиты
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {MOCK_VISITS_TOTAL} визитов
          </span>
        </button>
      </div>
    </section>
  );
}
