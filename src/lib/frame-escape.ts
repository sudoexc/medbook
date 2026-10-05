/**
 * Esc for a dialog that shows a page in a same-origin iframe.
 *
 * WHY: a key pressed while the focus is inside the frame fires in the
 * frame's own window, never in the parent document where the dialog
 * listens for Escape. The doctor clicked into the conclusion preview (to
 * scroll it, to select a line) and Esc stopped closing it. So the dialog
 * listens on the frame's window as well, once the frame has loaded.
 *
 * Pure (no React), so the unit tests can drive it with a plain EventTarget.
 */

export type KeyTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Calls `onEscape` on Escape in `target` (the frame's `contentWindow`).
 * Returns the function that stops listening. A missing window, or one the
 * browser does not let us touch (a frame that navigated cross-origin), is
 * a no-op rather than an error: Esc then simply works as it did before.
 */
export function listenForEscape(
  target: KeyTarget | null | undefined,
  onEscape: () => void,
): () => void {
  if (!target) return () => {};
  const onKey = (e: Event) => {
    const key = (e as Partial<KeyboardEvent>).key;
    if (key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    onEscape();
  };
  try {
    target.addEventListener("keydown", onKey);
  } catch {
    return () => {};
  }
  return () => {
    try {
      target.removeEventListener("keydown", onKey);
    } catch {
      // The frame is gone or cross-origin by now: nothing left to remove.
    }
  };
}
