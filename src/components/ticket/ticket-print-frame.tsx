"use client";

import { createPortal } from "react-dom";

/**
 * Prints the ticket stub (`/ticket/<id>`, opened with the staff session)
 * from a hidden frame on the current page: the stub prints itself
 * (AutoPrint), so no tab is opened and none is left behind. Used by the
 * desk's «Распечатать» (it opened a new tab that stayed open, owner report
 * 08.10.2026) and by the iPad's done screen.
 *
 * The print dialog is the browser's own and a page cannot skip it; Chrome
 * started with `--kiosk-printing` prints straight to the default printer
 * (the Xprinter at the desk).
 *
 * Safari on iPadOS may print the page around the frame instead of the frame
 * alone, so while a job is pending the page's own print styles show nothing
 * but the frame: either way the paper carries the slip. Each new `job`
 * remounts the frame, so pressing again prints again.
 *
 * One slip per press (owner report 10.10.2026): the frame lives at the end
 * of <body>, not in the queue row that asked for it, because a browser
 * reloads a frame each time its element moves and the rows move whenever
 * the queue reorders; and `?job=<token>` lets the stub print only once.
 */
export function TicketPrintFrame({
  appointmentId,
  job,
  token,
}: {
  appointmentId: string;
  job: number;
  token: string;
}) {
  if (job === 0 || typeof document === "undefined") return null;
  return createPortal(
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .ticket-print-frame, .ticket-print-frame * { visibility: visible !important; }
          .ticket-print-frame {
            position: fixed !important; inset: 0 auto auto 0 !important;
            width: 80mm !important; height: 200mm !important;
          }
          @page { size: 80mm auto; margin: 0; }
        }
      `}</style>
      <iframe
        key={job}
        src={`/ticket/${encodeURIComponent(appointmentId)}?job=${encodeURIComponent(token)}`}
        title="ticket"
        aria-hidden="true"
        tabIndex={-1}
        className="ticket-print-frame"
        style={{ position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" }}
      />
    </>,
    document.body,
  );
}
