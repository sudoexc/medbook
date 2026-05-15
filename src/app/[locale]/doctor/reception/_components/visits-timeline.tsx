"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MOCK_TIMELINE, MOCK_VISITS_TOTAL } from "../_mocks";

const SCROLL_STEP_PX = 320;

/**
 * Horizontal timeline of past visits. Currently rendered from mock data and
 * not imported by any live route (kept around so we can drop it back into a
 * patient-detail view later). Items live inside a scrollable flex container
 * so the arrow buttons can ferry the user along when the list overflows.
 *
 * The arrows used to be dead — clicking did nothing because the underlying
 * grid was `auto-cols-fr` (always fit-to-width, never overflowed). Wiring
 * onClick + a ref-based scroller keeps the buttons honest the moment real
 * data shows up; the disabled state listens to native `scroll` events so
 * we don't fight the browser's momentum.
 */
export function VisitsTimeline() {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = React.useState(false);
  const [canRight, setCanRight] = React.useState(false);

  const recompute = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 0);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  React.useEffect(() => {
    recompute();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      el.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [recompute]);

  const scrollBy = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-4 text-[15px] font-semibold text-foreground">
        Лента визитов
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label="Прокрутить назад"
          disabled={!canLeft}
          onClick={() => scrollBy(-SCROLL_STEP_PX)}
          className="motion-press flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-muted disabled:hover:text-muted-foreground"
        >
          <ChevronLeftIcon className="size-4" />
        </button>

        <div
          ref={scrollerRef}
          className="relative min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {/* Connector — passes through the vertical centre of the dots */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-2 h-px bg-border"
          />
          <ul className="relative flex">
            {MOCK_TIMELINE.map((p) => (
              <li
                key={p.id}
                className="flex w-32 shrink-0 flex-col items-center text-center"
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
          aria-label="Прокрутить вперёд"
          disabled={!canRight}
          onClick={() => scrollBy(SCROLL_STEP_PX)}
          className="motion-press flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-muted disabled:hover:text-muted-foreground"
        >
          <ChevronRightIcon className="size-4" />
        </button>

        <div className="flex shrink-0 flex-col items-end gap-0.5 self-start pt-1">
          <span className="text-xs font-semibold text-muted-foreground">
            Все визиты
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {MOCK_VISITS_TOTAL} визитов
          </span>
        </div>
      </div>
    </section>
  );
}
