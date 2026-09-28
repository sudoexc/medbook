/**
 * The waiting-room screens' SSE subscription (`/api/c/<slug>/queue/events`),
 * shared by the lobby board (`useQueueBoard`) and a doctor's own TV
 * (`useDoctorBoard`).
 *
 * A network drop is retried by the browser itself: the source goes back to
 * CONNECTING. A refused open is not. Any non-200 answer (the nginx 502 right
 * after a deploy, the per-address stream cap's 429, INF-10) leaves an
 * EventSource CLOSED for good. The screen then never gets `queue.called`
 * again, so no call overlay, no chime and no voice, while the snapshot poll
 * keeps its lists moving and it still looks alive. This helper notices the
 * CLOSED state and opens a fresh stream on the same URL after `reopenMs`.
 */

/** `EventSource.CLOSED` per the HTML spec, spelled out so tests run without the DOM global. */
export const EVENT_SOURCE_CLOSED = 2;

export interface BoardEventSourceHandlers {
  onOpen: () => void;
  onError: () => void;
  onMessage: (ev: MessageEvent) => void;
}

/** The slice of the EventSource API this helper drives. */
export interface BoardEventSourceLike {
  readonly readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  close(): void;
}

export type BoardEventSourceCtor = new (url: string) => BoardEventSourceLike;

/**
 * Opens `url` and keeps it open across refused reconnects. Returns the
 * dispose function: it closes the live source and cancels a pending reopen.
 */
export function openBoardEventSource(
  url: string,
  handlers: BoardEventSourceHandlers,
  reopenMs: number,
  Impl: BoardEventSourceCtor = EventSource,
): () => void {
  let current: BoardEventSourceLike | null = null;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const open = () => {
    reopenTimer = undefined;
    if (disposed) return;
    const source = new Impl(url);
    current = source;
    source.onopen = () => {
      if (disposed || source !== current) return;
      handlers.onOpen();
    };
    source.onerror = () => {
      if (disposed || source !== current) return;
      handlers.onError();
      if (source.readyState === EVENT_SOURCE_CLOSED && !reopenTimer) {
        source.close();
        reopenTimer = setTimeout(open, reopenMs);
      }
    };
    source.onmessage = (ev) => {
      if (disposed || source !== current) return;
      handlers.onMessage(ev);
    };
  };

  open();
  return () => {
    disposed = true;
    clearTimeout(reopenTimer);
    reopenTimer = undefined;
    current?.close();
    current = null;
  };
}
