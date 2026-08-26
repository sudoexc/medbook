"use client";

import * as React from "react";

/**
 * Ticking "now" for the Mini App, modelled on the doctor cabinet's
 * `useMinuteClock`.
 *
 * The screens used to freeze `Date.now()` at mount, which is wrong for a
 * Telegram Mini App specifically: the webview is not remounted when the
 * patient returns to it, so a session left open overnight kept rendering
 * yesterday's clock — the hero would insist a visit is «завтра» on the very
 * morning of that visit, and the greeting would still say «доброй ночи».
 *
 * A minute is the right granularity: every label here (greeting bucket,
 * today/tomorrow, "через N дн.", dose due) changes only on minute
 * boundaries, so a faster tick would just burn renders.
 *
 * Two things the doctor's version doesn't need:
 *   • re-align after the interval drifts — a frozen webview can miss ticks
 *     entirely, so we re-arm the alignment timeout on every tick instead of
 *     trusting a long-lived setInterval;
 *   • resync on `visibilitychange`, so coming back from the background
 *     updates the clock on the same frame the screen is painted.
 */
export function useMinuteClock(): number {
  const [now, setNow] = React.useState<number>(() => Date.now());

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      // Sync to the next minute boundary so labels flip exactly when the
      // wall clock does, not a random offset after mount.
      const msToNextMinute = 60_000 - (Date.now() % 60_000);
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, msToNextMinute);
    };

    const resync = () => {
      if (document.hidden) return;
      setNow(Date.now());
      if (timer) clearTimeout(timer);
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", resync);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resync);
    };
  }, []);

  return now;
}
