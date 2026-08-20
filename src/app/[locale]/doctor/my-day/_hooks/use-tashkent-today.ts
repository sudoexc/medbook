"use client";

import * as React from "react";

import { tashkentToday } from "@/lib/tashkent-time";

/**
 * Today's clinic date (Asia/Tashkent, UTC+5) as YYYY-MM-DD — and it stays
 * today across midnight.
 *
 * Clinic tabs are left open for days. Computing the date once in a
 * `useMemo(..., [])` froze "today" at mount time: after midnight the
 * dashboard kept requesting yesterday's schedule and the status mutations
 * kept patching yesterday's cache key. This hook re-checks the date on a
 * minute-aligned interval and updates state only when the civil day
 * actually flips, so subscribers re-render exactly once per rollover.
 *
 * An interval (rather than a single setTimeout aimed at midnight) survives
 * laptop sleep / background-tab throttling: whenever the timer next fires,
 * the comparison against wall-clock time self-corrects.
 */
export function useTashkentToday(): string {
  const [today, setToday] = React.useState<string>(() => tashkentToday());

  React.useEffect(() => {
    const check = () =>
      setToday((prev) => {
        const next = tashkentToday();
        // Same-value bailout: React skips the re-render for 1439 of the
        // 1440 daily ticks.
        return next === prev ? prev : next;
      });
    // Align to the minute boundary so the flip lands within seconds of
    // actual midnight instead of up to a minute late.
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | undefined;
    const align = setTimeout(() => {
      check();
      interval = setInterval(check, 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);

  return today;
}
