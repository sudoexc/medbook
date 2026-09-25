"use client";

import { useEffect } from "react";

import { reachGoal } from "@/lib/site-analytics";

/**
 * One document-level listener instead of an onClick on every button: the
 * landing sections stay server components, and a phone link added anywhere
 * later is counted without anyone remembering to wire it.
 *
 *   - any `tel:` link          → goal `call`
 *   - any `[data-goal="…"]`    → that goal (route, booking-open, …)
 */
export function SiteGoalTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const tagged = target.closest<HTMLElement>("[data-goal]");
      if (tagged?.dataset.goal) {
        reachGoal(tagged.dataset.goal);
        return;
      }
      if (target.closest('a[href^="tel:"]')) reachGoal("call");
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
