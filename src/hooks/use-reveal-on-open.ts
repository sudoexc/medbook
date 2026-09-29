"use client";

import * as React from "react";

/**
 * Keeps an inline dropdown visible when it opens.
 *
 * The visit screen's pickers (diagnosis, prescriptions) render their lists
 * absolutely under the search field. «Назначения» sits at the bottom of the
 * middle column, so its list opened below the fold and slid under the sticky
 * «Завершить приём» bar. On open we scroll the list into view; the list's
 * own `scroll-mb-*` margin keeps it clear of that bar.
 */
export function useRevealOnOpen<T extends HTMLElement>(open: boolean) {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    if (!open) return;
    // After paint, so the list has its final height.
    const id = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);
  return ref;
}
