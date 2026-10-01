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
    const id = setTimeout(() => {
      try {
        window.print();
      } catch {
        // Print unavailable (e.g. headless preview) — no-op.
      }
    }, delayMs);
    return () => clearTimeout(id);
  }, [delayMs]);
  return null;
}
