"use client";

import * as React from "react";

import { tashkentToday } from "@/lib/tashkent-time";

/** How often the day is re-read while the tab is open. */
const TICK_MS = 30_000;

/** The slice of `window` / `document` the watcher needs (fakes in tests). */
export interface ClinicDayEnv {
  win: Pick<
    Window,
    "setInterval" | "clearInterval" | "addEventListener" | "removeEventListener"
  >;
  doc: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
}

/**
 * Report the clinic day on every tick, on window focus and when the tab
 * comes back into view. Returns the unsubscribe.
 *
 * A short interval rather than one timer to midnight: a laptop asleep over
 * midnight fires a long timer late, and background tabs throttle timers.
 */
export function watchClinicDay(
  onDay: (day: string) => void,
  env: ClinicDayEnv,
): () => void {
  const refresh = () => onDay(tashkentToday());
  const onVisible = () => {
    if (env.doc.visibilityState === "visible") refresh();
  };
  const id = env.win.setInterval(refresh, TICK_MS);
  env.win.addEventListener("focus", refresh);
  env.doc.addEventListener("visibilitychange", onVisible);
  return () => {
    env.win.clearInterval(id);
    env.win.removeEventListener("focus", refresh);
    env.doc.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * Today's clinic (Asia/Tashkent) day as `YYYY-MM-DD`, following the clock
 * (audit AP-12).
 *
 * The reception computer is not switched off at night. The page used to fix
 * "today" once, when it mounted, so the next morning it showed yesterday's
 * list as today's next to KPIs that were already counting the new day.
 * React skips the re-render while the string stays the same, so the ticks
 * cost nothing.
 */
export function useClinicToday(): string {
  const [today, setToday] = React.useState<string>(() => tashkentToday());
  React.useEffect(
    () => watchClinicDay(setToday, { win: window, doc: document }),
    [],
  );
  return today;
}
