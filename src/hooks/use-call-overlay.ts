"use client";

import { useEffect, useState } from "react";

/** How long the «Пройдите в кабинет» takeover stays on a waiting-room TV. */
export const CALL_OVERLAY_MS = 15_000;

/**
 * Whether the call takeover is showing: a call arrived and its own timer has
 * not dismissed it yet. Pure, so the TV can derive the overlay on every
 * render instead of holding it in state.
 */
export function isCallOverlayOpen(
  callSeq: number | null | undefined,
  dismissedSeq: number,
): boolean {
  return callSeq != null && callSeq > 0 && callSeq !== dismissedSeq;
}

/**
 * Auto-dismiss for the call takeover, keyed on the call's `seq` ONLY.
 *
 * The shared /tv board used to arm this timer inside the effect that also
 * read the board snapshot (deps [call, doctors]). Every call triggers a board
 * refetch 400 ms later, the new `doctors` array re-ran that effect, its
 * cleanup cleared the timer, and the re-run bailed out on «already seen this
 * seq» without arming a new one: the green screen stayed up until the next
 * call and hid the queue (audit Q-02). Board refreshes must never touch the
 * timer, so it depends on nothing but the seq.
 */
export function useCallOverlayOpen(
  callSeq: number | null | undefined,
  durationMs: number = CALL_OVERLAY_MS,
): boolean {
  const [dismissedSeq, setDismissedSeq] = useState(0);
  useEffect(() => {
    if (callSeq == null || callSeq <= 0) return;
    const t = setTimeout(() => setDismissedSeq(callSeq), durationMs);
    return () => clearTimeout(t);
  }, [callSeq, durationMs]);
  return isCallOverlayOpen(callSeq, dismissedSeq);
}
