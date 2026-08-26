/**
 * Reconnect policy for the Mini App SSE subscription.
 *
 * Extracted from the hook as pure functions so the rules that actually
 * caused the "app is stuck after coming back from the background" bug are
 * unit-testable without a DOM.
 *
 * Background: the browser's built-in EventSource retry gives up permanently
 * on a hard handshake failure (401 once initData expires after 24h, 502
 * during a deploy). `readyState` parks at CLOSED and nothing reopens it — the
 * patient sees a frozen screen with a cheerfully pulsing "live" dot. So the
 * client owns the retry, and coming back to the foreground short-circuits any
 * pending backoff.
 */

/** Connection state the UI is allowed to claim. */
export type MiniAppLiveStatus = "connecting" | "live" | "offline";

/** Backoff curve: 1s, 2s, 4s, 8s, 16s, 32s → capped at 30s. */
export function backoffDelayMs(attempt: number): number {
  const base = 1000 * 2 ** Math.min(Math.max(0, attempt), 5);
  return Math.min(30_000, base);
}

/**
 * Whether an error should schedule another connect attempt.
 *
 * Always true while the subscription is mounted: there is no error class we
 * can treat as permanent. A 401 is recoverable (Telegram reissues initData on
 * the next app open) and a 502 is recoverable (the deploy finishes). Giving
 * up is precisely the old bug.
 */
export function shouldRetryAfterError(disposed: boolean): boolean {
  return !disposed;
}

/**
 * Whether returning to the foreground should force an immediate reconnect,
 * bypassing any pending backoff timer.
 *
 * `readyState === CLOSED` (2) means the socket is definitively gone.
 * A missing socket means we're sitting inside a backoff window. Both must
 * reconnect now rather than after a delay that may be up to 30s — the patient
 * is looking at the screen right now.
 */
export function shouldReviveOnForeground(params: {
  hidden: boolean;
  disposed: boolean;
  readyState: number | null;
}): boolean {
  const { hidden, disposed, readyState } = params;
  if (disposed || hidden) return false;
  // CLOSED === 2 in the EventSource spec; `null` = no socket at all.
  return readyState === null || readyState === 2;
}

/**
 * Whether returning to the foreground should invalidate the mini-app cache.
 *
 * Unconditionally yes (when actually visible and mounted). We cannot know
 * what the clinic changed while the webview was frozen, and events published
 * during the freeze are only replayed if the socket happened to survive.
 * A brief refetch spinner beats confidently showing hours-old data.
 */
export function shouldInvalidateOnForeground(params: {
  hidden: boolean;
  disposed: boolean;
}): boolean {
  return !params.disposed && !params.hidden;
}
