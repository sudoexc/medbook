"use client";

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
 */
export function TicketPrintFrame({ appointmentId, job }: { appointmentId: string; job: number }) {
  if (job === 0) return null;
  return (
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
        src={`/ticket/${appointmentId}`}
        title="ticket"
        aria-hidden="true"
        tabIndex={-1}
        className="ticket-print-frame"
        style={{ position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" }}
      />
    </>
  );
}
