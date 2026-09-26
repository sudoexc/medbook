"use client";

/**
 * `useLiveEvents(onEvent, filter?)` — subscribe to the app's SSE stream.
 *
 * All consumers share **one** `EventSource` per page (ref-counted). The
 * first mount opens `/api/events`; later mounts attach to the same
 * connection. The last unmount closes it. This keeps browser socket
 * budgets sane even if dozens of hooks render concurrently.
 *
 * Features:
 *   - Exponential backoff reconnect (1s, 2s, 4s, … capped at 30s).
 *   - SSR-safe: on the server / during test, subscribing is a no-op.
 *   - Zod-validated payloads: malformed events never reach callers.
 *   - Accepts both envelope generations (v1 `AppEvent` + v2 outbox
 *     `EventEnvelope`) — see `parseLiveEvent` below.
 *   - Optional `filter` to narrow the subscription to a set of event types.
 *   - Catch-up after a gap (audit INF-06): the last v2 `eventId` is kept on
 *     the shared source and sent back as `?since=` on every reconnect, so
 *     the server replays what the outbox recorded meanwhile. Replay cannot
 *     be the whole answer: v1 events (`publishEventSafe`) never reach the
 *     outbox. So every reconnect after a drop, and every server resync
 *     signal (`cursor-too-old` and friends, see SSE_RESYNC_EVENTS), also
 *     calls the subscribers' `onResync`, which refetch what they show.
 */

import * as React from "react";

import {
  AppEventSchema,
  type AppEvent,
  type EventType,
} from "@/server/realtime/events";
import { EventEnvelopeSchema } from "@/server/realtime/envelope";

type Listener = (event: AppEvent) => void;
type ResyncListener = () => void;

/**
 * Named SSE events the server sends when a replay cannot be trusted to be
 * complete. They are named events on purpose: an SSE comment (`: …`) is
 * invisible to JS, which is how the old `: cursor-too-old` signal was dead.
 *   - cursor-too-old:   the `since` row is gone (outbox TTL) or foreign.
 *   - replay-truncated: more rows were missed than one replay carries.
 *   - replay-failed:    the replay query itself failed.
 */
export const SSE_RESYNC_EVENTS = [
  "cursor-too-old",
  "replay-truncated",
  "replay-failed",
] as const;

/** The stream URL, resuming after `lastEventId` when we have one. */
export function liveEventsUrl(lastEventId: string | null): string {
  return lastEventId
    ? `/api/events?since=${encodeURIComponent(lastEventId)}`
    : "/api/events";
}

/**
 * Normalize a raw SSE frame into an `AppEvent`, accepting BOTH envelope
 * generations that ride the shared bus (see `docs/architecture/REALTIME.md` §2):
 *
 *   - v1 `AppEvent`       — `clinicId` on the top level
 *   - v2 `EventEnvelope`  — `clinicId` nested inside `tenantScope`
 *
 * The schemas are mutually unparsable (v1 requires top-level `clinicId`, v2
 * requires `tenantScope`/`actor`), so a parser that knows only one silently
 * drops the other generation. That is exactly how every outbox-published
 * event (`visit-note.finalized`, `patient.arrived`, `nps.submitted`, …)
 * used to vanish before reaching CRM subscribers — masked by the 60s
 * safety-net polling. Same fix as the mini-app's `extractEventType`.
 *
 * v2 envelopes are flattened back to the v1 shape (clinicId lifted out of
 * `tenantScope`) and re-validated against `AppEventSchema`, so listeners
 * keep the "Zod-validated typed payload" guarantee regardless of dialect.
 * Returns `null` for malformed frames.
 */
export function parseLiveEvent(parsed: unknown): AppEvent | null {
  const v1 = AppEventSchema.safeParse(parsed);
  if (v1.success) return v1.data;

  const v2 = EventEnvelopeSchema.safeParse(parsed);
  if (!v2.success) return null;

  const flattened = AppEventSchema.safeParse({
    type: v2.data.type,
    clinicId: v2.data.tenantScope.clinicId,
    at: v2.data.at,
    payload: v2.data.payload,
  });
  return flattened.success ? flattened.data : null;
}

type SharedSource = {
  es: EventSource | null;
  listeners: Set<Listener>;
  /** Called after a reconnect or a server resync signal (INF-06). */
  resyncListeners: Set<ResyncListener>;
  refCount: number;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Deferred-close handle. When the last subscriber unmounts we don't drop
   * the socket immediately — a route transition unmounts the old page's
   * hooks a tick before the new page's hooks mount, and tearing the socket
   * down in that gap loses any event published mid-transition. We wait out a
   * short grace window and only close if nobody re-subscribed.
   */
  idleCloseTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Id of the newest v2 envelope delivered. A fresh `new EventSource(url)`
   * does not send `Last-Event-ID` (only the browser's own retry of the SAME
   * object does), and we always reconnect with a fresh object, so the id is
   * carried here and sent as `?since=`.
   */
  lastEventId: string | null;
  /** True once a connection has opened: every later open is a reconnect. */
  hasOpened: boolean;
};

/**
 * How long the shared EventSource stays open after the last subscriber
 * leaves. Covers SPA navigation between CRM pages (reception → telegram →
 * calendar) without a reconnect flap. Short enough that a truly-closed tab
 * still releases the socket promptly.
 */
const IDLE_CLOSE_GRACE_MS = 5_000;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof EventSource !== "undefined";
}

// Vitest sets `VITEST` env; avoid opening connections during unit tests.
function isTestEnv(): boolean {
  if (typeof process === "undefined") return false;
  return (
    process.env?.NODE_ENV === "test" || Boolean(process.env?.VITEST)
  );
}

type EventSourceCtor = new (
  url: string,
  init?: EventSourceInit,
) => EventSource;

// Test seam: unit tests run in node with no EventSource, and the hook
// refuses to connect under vitest. A test installs a fake constructor here
// to drive the real reconnect / replay / resync logic.
let transportForTests: EventSourceCtor | null = null;

/** Test-only: route connections through a fake EventSource (null restores). */
export function __setLiveEventsTransportForTests(
  ctor: EventSourceCtor | null,
): void {
  transportForTests = ctor;
}

function resolveTransport(): EventSourceCtor | null {
  if (transportForTests) return transportForTests;
  if (!isBrowser() || isTestEnv()) return null;
  return EventSource;
}

// Module-scoped singleton; one per tab.
let shared: SharedSource | null = null;

function getShared(): SharedSource {
  if (!shared) {
    shared = {
      es: null,
      listeners: new Set(),
      resyncListeners: new Set(),
      refCount: 0,
      retryAttempt: 0,
      retryTimer: null,
      idleCloseTimer: null,
      lastEventId: null,
      hasOpened: false,
    };
  }
  return shared;
}

function notifyResync(s: SharedSource): void {
  for (const listener of Array.from(s.resyncListeners)) {
    try {
      listener();
    } catch (err) {
      console.warn("[useLiveEvents] resync listener threw", err);
    }
  }
}

function backoffDelayMs(attempt: number): number {
  const base = 1000 * 2 ** Math.min(attempt, 5); // 1s .. 32s
  return Math.min(30_000, base);
}

function openConnection(): void {
  const Transport = resolveTransport();
  if (!Transport) return;
  const s = getShared();
  if (s.es) return;

  const es = new Transport(liveEventsUrl(s.lastEventId), {
    withCredentials: true,
  });
  s.es = es;

  es.onopen = () => {
    s.retryAttempt = 0;
    // INF-06 — anything published while we were away is unknown to us: a
    // deploy, a Wi-Fi blink or a sleeping laptop used to leave the doctor's
    // screen on «ожидается» until some unrelated event happened to land.
    // The first open is not a gap (the queries have just fetched).
    const reconnected = s.hasOpened;
    s.hasOpened = true;
    if (reconnected) notifyResync(s);
  };

  for (const name of SSE_RESYNC_EVENTS) {
    es.addEventListener(name, () => {
      // A cursor the server no longer knows must not be offered again.
      if (name === "cursor-too-old") s.lastEventId = null;
      notifyResync(s);
    });
  }

  es.onmessage = (ev) => {
    if (!ev.data) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    // The `id:` line rides v2 envelopes only; `lastEventId` keeps the last
    // one seen across v1 frames, which is exactly the resume point.
    const eventId =
      (ev as MessageEvent).lastEventId ||
      (parsed as { eventId?: unknown } | null)?.eventId;
    if (typeof eventId === "string" && eventId.length > 0) {
      s.lastEventId = eventId;
    }
    // Both envelope dialects (v1 AppEvent + v2 outbox EventEnvelope) arrive
    // on this stream — normalize instead of parsing v1-only, or every
    // outbox-published event is silently dropped.
    const event = parseLiveEvent(parsed);
    if (!event) return;
    // Snapshot: listeners may unsubscribe during dispatch.
    for (const listener of Array.from(s.listeners)) {
      try {
        listener(event);
      } catch (err) {
        // Don't let one bad listener break the others.
        console.warn("[useLiveEvents] listener threw", err);
      }
    }
  };

  es.onerror = () => {
    // The browser auto-reconnects, but we close + reopen on a backoff so
    // proxies that hold broken connections don't pin us forever.
    try {
      es.close();
    } catch {
      /* ignore */
    }
    s.es = null;
    if (s.listeners.size === 0) return; // nobody cares anymore
    const attempt = s.retryAttempt++;
    if (s.retryTimer) clearTimeout(s.retryTimer);
    s.retryTimer = setTimeout(() => {
      s.retryTimer = null;
      openConnection();
    }, backoffDelayMs(attempt));
  };
}

function closeConnectionIfIdle(): void {
  const s = getShared();
  if (s.refCount > 0) return;
  if (s.idleCloseTimer) {
    clearTimeout(s.idleCloseTimer);
    s.idleCloseTimer = null;
  }
  if (s.retryTimer) {
    clearTimeout(s.retryTimer);
    s.retryTimer = null;
  }
  if (s.es) {
    try {
      s.es.close();
    } catch {
      /* ignore */
    }
    s.es = null;
  }
}

/**
 * Schedule an idle close after the grace window. A no-op if a close is
 * already pending or someone is still subscribed. Cancelled by the next
 * subscriber via `cancelIdleClose`.
 */
function scheduleIdleClose(): void {
  const s = getShared();
  if (s.refCount > 0) return;
  if (s.idleCloseTimer) return;
  s.idleCloseTimer = setTimeout(() => {
    s.idleCloseTimer = null;
    closeConnectionIfIdle();
  }, IDLE_CLOSE_GRACE_MS);
}

/** A new subscriber arrived — keep the warm socket. */
function cancelIdleClose(): void {
  const s = getShared();
  if (s.idleCloseTimer) {
    clearTimeout(s.idleCloseTimer);
    s.idleCloseTimer = null;
  }
}

export type UseLiveEventsOptions = {
  /** Narrow subscription to these event types. Omit to receive all. */
  filter?: ReadonlyArray<EventType>;
  /** Disable the subscription entirely without unmounting. */
  enabled?: boolean;
  /**
   * Called when events may have been missed: after the shared stream
   * reconnects, or when the server says its replay is incomplete. Refetch
   * whatever this subscriber keeps live (INF-06).
   */
  onResync?: () => void;
};

/**
 * Attach a listener to the shared stream (opening it if needed). The hook
 * below is a thin effect around this; kept separate so the connection
 * logic can be unit-tested without React. Returns the unsubscribe.
 */
export function subscribeLiveEvents(
  listener: Listener,
  onResync?: ResyncListener,
): () => void {
  const s = getShared();
  cancelIdleClose();
  s.listeners.add(listener);
  if (onResync) s.resyncListeners.add(onResync);
  s.refCount += 1;
  openConnection();
  return () => {
    s.listeners.delete(listener);
    if (onResync) s.resyncListeners.delete(onResync);
    s.refCount = Math.max(0, s.refCount - 1);
    if (s.refCount === 0) scheduleIdleClose();
  };
}

export function useLiveEvents(
  onEvent: Listener,
  options: UseLiveEventsOptions = {},
): void {
  const { filter, enabled = true, onResync } = options;
  // Stable ref so consumers can pass inline callbacks without re-subscribing.
  const cbRef = React.useRef(onEvent);
  React.useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);
  const resyncRef = React.useRef(onResync);
  React.useEffect(() => {
    resyncRef.current = onResync;
  }, [onResync]);

  const filterKey = React.useMemo(() => {
    if (!filter) return "*";
    // Deterministic key so two hooks with the same filter share the same
    // memo key — useful in dev-mode StrictMode double-invokes.
    return Array.from(new Set(filter)).sort().join("|");
  }, [filter]);

  React.useEffect(() => {
    if (!enabled) return;
    if (!isBrowser() || isTestEnv()) return;

    // Rebuild the type filter from the stable `filterKey` string, NOT the
    // `filter` array — callers pass an inline literal, so its identity
    // changes every render. Depending on the array would re-run this effect
    // on every render: when several subscribers re-render in one commit React
    // flushes all their cleanups before any re-create, so `refCount` hits 0
    // and the shared EventSource is torn down and reopened. Events published
    // in that reconnect gap are lost (no Last-Event-ID replay) — exactly the
    // "reception/telegram didn't update until I refreshed" symptom.
    const filterSet: Set<EventType> | null =
      filterKey === "*"
        ? null
        : (new Set(filterKey.split("|")) as Set<EventType>);

    const listener: Listener = (event) => {
      if (filterSet && !filterSet.has(event.type)) return;
      cbRef.current(event);
    };

    return subscribeLiveEvents(listener, () => resyncRef.current?.());
  }, [enabled, filterKey]);
}

/** Test-only: close the shared connection. Safe to no-op in prod. */
export function __resetLiveEventsForTests(): void {
  const s = getShared();
  s.listeners.clear();
  s.resyncListeners.clear();
  s.refCount = 0;
  closeConnectionIfIdle();
  s.retryAttempt = 0;
  s.lastEventId = null;
  s.hasOpened = false;
}
