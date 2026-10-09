/**
 * Prints a ticket from the desk PC without opening anything: the stub loads
 * in a hidden frame on the current page and prints itself (AutoPrint).
 *
 * Silent printing (no dialog, straight to the Xprinter) is Chrome's own
 * `--kiosk-printing` switch on the desk PC; no page can skip the dialog by
 * itself. A separate window was tried on 09.10.2026 and the owner did not
 * want it («отдельное окно мне не нужно»): with the switch off it changed
 * nothing, with it on the frame prints just as silently.
 *
 * One frame at a time: a new print replaces the previous one, and the frame
 * is removed a minute later.
 */
const FRAME_ID = "neurofax-ticket-print";

export function openTicketPrint(appointmentId: string): void {
  document.getElementById(FRAME_ID)?.remove();
  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.title = "ticket";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.src = `/ticket/${encodeURIComponent(appointmentId)}`;
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    visibility: "hidden",
  });
  document.body.appendChild(frame);
  window.setTimeout(() => {
    if (document.getElementById(FRAME_ID) === frame) frame.remove();
  }, 60_000);
}
