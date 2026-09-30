"use client";

import * as React from "react";

function subscribe(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/**
 * Whether the page is in front of the operator (not a background tab, not a
 * minimised window). A message that arrives in a hidden tab is not read
 * (audit G6-05); it is once the tab comes back.
 */
export function usePageVisible(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => document.visibilityState === "visible",
    () => true,
  );
}
