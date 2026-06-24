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
 *   - Optional `filter` to narrow the subscription to a set of event types.
 */

import * as React from "react";

import {
  AppEventSchema,
  type AppEvent,
  type EventType,
} from "@/server/realtime/events";

type Listener = (event: AppEvent) => void;

type SharedSource = {
  es: EventSource | null;
  listeners: Set<Listener>;
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

// Module-scoped singleton; one per tab.
let shared: SharedSource | null = null;

function getShared(): SharedSource {
  if (!shared) {
    shared = {
      es: null,
      listeners: new Set(),
      refCount: 0,
      retryAttempt: 0,
      retryTimer: null,
      idleCloseTimer: null,
    };
  }
  return shared;
}

function backoffDelayMs(attempt: number): number {
  const base = 1000 * 2 ** Math.min(attempt, 5); // 1s .. 32s
  return Math.min(30_000, base);
}

function openConnection(): void {
  if (!isBrowser() || isTestEnv()) return;
  const s = getShared();
  if (s.es) return;

  const es = new EventSource("/api/events", { withCredentials: true });
  s.es = es;

  es.onopen = () => {
    s.retryAttempt = 0;
  };

  es.onmessage = (ev) => {
    if (!ev.data) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    const result = AppEventSchema.safeParse(parsed);
    if (!result.success) return;
    const event = result.data;
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
};

export function useLiveEvents(
  onEvent: Listener,
  options: UseLiveEventsOptions = {},
): void {
  const { filter, enabled = true } = options;
  // Stable ref so consumers can pass inline callbacks without re-subscribing.
  const cbRef = React.useRef(onEvent);
  React.useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);

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

    const s = getShared();
    cancelIdleClose();
    s.listeners.add(listener);
    s.refCount += 1;
    openConnection();

    return () => {
      s.listeners.delete(listener);
      s.refCount = Math.max(0, s.refCount - 1);
      if (s.refCount === 0) scheduleIdleClose();
    };
  }, [enabled, filterKey]);
}

/** Test-only: close the shared connection. Safe to no-op in prod. */
export function __resetLiveEventsForTests(): void {
  const s = getShared();
  s.listeners.clear();
  s.refCount = 0;
  closeConnectionIfIdle();
  s.retryAttempt = 0;
}
