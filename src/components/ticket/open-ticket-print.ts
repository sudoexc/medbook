/**
 * Prints a ticket from the desk PC: the stub opens in a small window, prints
 * itself (AutoPrint) and closes once the print is done (`?close=1`).
 *
 * Why a window and not the hidden frame the iPad uses: Chrome started with
 * `--kiosk-printing` (the desk's silent printing to the Xprinter) prints a
 * page's own window.print() at once, but a hidden frame's print brought the
 * dialog back (owner report 09.10.2026: «выходит окно и нажимаю ещё раз
 * печать»). The window used to stay open after printing; now it closes.
 * Called from a click, so the popup blocker lets it through; one named
 * window, so a second print reuses it.
 */
export function openTicketPrint(appointmentId: string): void {
  window.open(
    `/ticket/${encodeURIComponent(appointmentId)}?close=1`,
    "neurofax-ticket-print",
    "popup,width=440,height=680",
  );
}
