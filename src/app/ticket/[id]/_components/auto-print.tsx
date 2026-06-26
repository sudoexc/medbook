"use client";

import { useEffect } from "react";

/**
 * Fires the browser print dialog shortly after the ticket renders, so a kiosk
 * that opens `/ticket/[id]` in a new tab prints to the thermal printer without
 * staff touching the screen. Mirrors the `setTimeout(window.print, …)` pattern
 * used by the document print routes; the delay lets the QR <img> paint first.
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
