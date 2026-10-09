"use client";

import * as React from "react";

/** How often an open page asks which build the server runs. */
const CHECK_MS = 60_000;
/** How often a page that knows it is stale looks for a safe moment. */
const RETRY_MS = 10_000;

/**
 * Reloads an open page after a deploy (owner request 09.10.2026): desk PCs,
 * the iPad and the TVs kept a page open all day and stayed on the old
 * version until someone pressed F5, so new features «did not work».
 *
 * The page notes the build it loaded (/api/version), asks again every
 * minute and on coming back into view, and once the server runs a new build
 * reloads at a safe moment only: nobody has touched the page for `idleMs`,
 * no field has the focus, no dialog is open, and nothing matching
 * `blockSelector` is on screen (a TV calling a patient). So nothing typed
 * is lost. In development (`build: "dev"`) it does nothing.
 */
export function VersionWatch({
  idleMs = 45_000,
  blockSelector,
}: {
  idleMs?: number;
  blockSelector?: string;
}) {
  React.useEffect(() => {
    let loaded: string | null = null;
    let stale = false;
    let lastInput = Date.now();
    let stopped = false;

    const onInput = () => {
      lastInput = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;
    for (const e of events) window.addEventListener(e, onInput, { passive: true, capture: true });

    const safe = () => {
      if (document.visibilityState === "visible" && Date.now() - lastInput < idleMs) return false;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return false;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
      if (blockSelector && document.querySelector(blockSelector)) return false;
      return true;
    };

    const check = async () => {
      if (stopped || stale) return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!build || build === "dev") return;
        if (loaded === null) loaded = build;
        else if (build !== loaded) stale = true;
      } catch {
        // Offline or the server restarting mid-deploy: ask again later.
      }
    };

    void check();
    const checker = window.setInterval(() => void check(), CHECK_MS);
    const retrier = window.setInterval(() => {
      if (stale && safe()) window.location.reload();
    }, RETRY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.clearInterval(checker);
      window.clearInterval(retrier);
      document.removeEventListener("visibilitychange", onVisible);
      for (const e of events) window.removeEventListener(e, onInput, { capture: true });
    };
  }, [idleMs, blockSelector]);
  return null;
}
