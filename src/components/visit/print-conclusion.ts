/**
 * Prints a visit's conclusion sheet in one press (owner report 09.10.2026):
 * the doctor had to open the preview and print from the right-click menu,
 * which printed the whole CRM page around it, three sheets. The sheet loads
 * in a hidden frame and prints itself (`?autoprint=1`), so only the sheet
 * reaches the printer; the print dialog is the browser's own (Chrome with
 * --kiosk-printing skips it). `type: "package"` prints the visit package.
 * One frame at a time, removed a minute later.
 */
const FRAME_ID = "neurofax-conclusion-print";

export function printConclusion(noteId: string, type?: "package"): void {
  document.getElementById(FRAME_ID)?.remove();
  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.title = "conclusion";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  const params = new URLSearchParams({ autoprint: "1" });
  if (type) params.set("type", type);
  frame.src = `/api/crm/visit-notes/${encodeURIComponent(noteId)}/print?${params}`;
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
