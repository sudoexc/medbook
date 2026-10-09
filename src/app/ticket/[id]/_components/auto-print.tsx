"use client";

import { useEffect } from "react";

/**
 * Fires the browser print dialog shortly after the ticket renders, so the
 * stub prints to the thermal printer without staff touching the screen.
 * Mirrors the `setTimeout(window.print, …)` pattern used by the document
 * print routes; the delay lets the QR <img> paint first.
 *
 * The kiosk loads the stub in a hidden frame on its own page (audit Q-09):
 * `window` is then the frame's, so only the slip prints and nothing is left
 * open over the kiosk. The front desk's tab prints the same way.
 */
export function AutoPrint({ delayMs = 350 }: { delayMs?: number }) {
  useEffect(() => {
    // The desk opens the stub in its own small window (`?close=1`, see
    // components/ticket/open-ticket-print.ts): it closes once printed, or
    // once the print dialog is cancelled.
    const closeAfter = new URLSearchParams(window.location.search).get("close") === "1";
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
