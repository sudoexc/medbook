"use client";

import { useEffect } from "react";

/** sessionStorage key marking a print job (`?job=`) as already printed. */
export const PRINTED_JOB_KEY = "nf-ticket-printed:";

/**
 * Fires the browser print dialog shortly after the ticket renders, so the
 * stub prints to the thermal printer without staff touching the screen.
 * Mirrors the `setTimeout(window.print, …)` pattern used by the document
 * print routes; the delay lets the QR <img> paint first.
 *
 * The kiosk loads the stub in a hidden frame on its own page (audit Q-09):
 * `window` is then the frame's, so only the slip prints and nothing is left
 * open over the kiosk. The front desk's tab prints the same way.
 *
 * A stub opened for one print job (`?job=<token>`, the desk's and the iPad's
 * hidden frame) prints once: a browser reloads a frame whenever its element
 * moves in the page, and an old slip came out again before every new one
 * (owner report 10.10.2026, «сначала выходит A-023, потом правильный»).
 * The frame shares the page's sessionStorage, so the mark outlives reloads.
 */
export function AutoPrint({ delayMs = 350 }: { delayMs?: number }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const job = params.get("job");
    if (job) {
      try {
        if (window.sessionStorage.getItem(PRINTED_JOB_KEY + job)) return;
        window.sessionStorage.setItem(PRINTED_JOB_KEY + job, "1");
      } catch {
        // Storage blocked: print as before.
      }
    }
    // The desk opens the stub in its own small window (`?close=1`, see
    // components/ticket/open-ticket-print.ts): it closes once printed, or
    // once the print dialog is cancelled.
    const closeAfter = params.get("close") === "1";
    const onAfterPrint = () => window.close();
    if (closeAfter) window.addEventListener("afterprint", onAfterPrint);
    const id = setTimeout(() => {
      try {
        window.print();
      } catch {
        // Print unavailable (e.g. headless preview) — no-op.
      }
    }, delayMs);
    return () => {
      clearTimeout(id);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [delayMs]);
  return null;
}
