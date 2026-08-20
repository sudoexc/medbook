"use client";

import * as React from "react";

/**
 * Tick once a minute so relative-time labels stay honest. Using the
 * minute as the clock instead of seconds keeps the render rate down
 * (10 rows × 1 update/min vs 10 × 60), and the user can't tell the
 * difference because the label only changes on minute boundaries.
 */
export function useMinuteClock(): number {
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    // Sync to the next minute boundary so all rows update in lockstep.
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: ReturnType<typeof setInterval> | undefined;
    const align = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}
