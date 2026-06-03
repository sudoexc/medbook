"use client";

/**
 * Phase M3 — Mini App realtime hook.
 *
 * Opens one EventSource per page (ref-counted across consumers) at
 * `/api/miniapp/events?clinicSlug=…&initData=…` and dispatches envelopes to
 * a TanStack-Query invalidation map. `useMiniAppLiveEvents()` is the side-
 * effect-only top-level subscriber; mount it once inside `MiniAppShell`.
 *
 * Why `?initData=` instead of a header: the browser's EventSource API
 * forbids custom headers, so we pass the same HMAC-signed initData blob via
 * a query parameter. The server verifies it identically.
 *
 * Last-Event-ID resilience:
 *   • The browser EventSource auto-sends `Last-Event-ID` on reconnect, so a
 *     transient network blip silently catches up via the EventOutbox replay
 *     path in the server handler.
 *   • We also stash the latest delivered `eventId` in `sessionStorage` and
 *     append it as `?since=<id>` on the *first* connect — that covers the
 *     "TG webview was backgrounded for 30 minutes, EventSource lost its
 *     in-memory cursor" case.
 *   • If the cursor row is gone (`: cursor-too-old\n\n`), we wipe the whole
 *     `["miniapp"]` cache and refetch — the alternative is silently stale
 *     data after long backgrounding.
 *
 * Invalidation map: lives in `MINIAPP_INVALIDATION_MAP`. Each event maps to
 * the React-Query prefixes a screen depends on; the dispatcher
 * `invalidateQueries({ queryKey: prefix })` works prefix-matching so the
 * full key shape (`["miniapp", "appointments", clinicSlug, ...]`) is
 * matched without per-entry knowledge of trailing filters.
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  AppEventSchema,
  type AppEvent,
  type EventType,
} from "@/server/realtime/events";

import { useMiniAppAuth } from "../_components/miniapp-auth-provider";

type QueryPrefix = ReadonlyArray<string>;

/**
 * Event → list of React-Query key prefixes to invalidate. A single event may
 * touch multiple screens (e.g. `nps.submitted` refreshes the patient's
 * "thank you" screen *and* the appointments list which highlights "rated").
 */
const MINIAPP_INVALIDATION_MAP: Partial<Record<EventType, QueryPrefix[]>> = {
  "appointment.created": [["miniapp", "appointments"]],
  "appointment.updated": [["miniapp", "appointments"]],
  "appointment.statusChanged": [["miniapp", "appointments"]],
  "appointment.cancelled": [["miniapp", "appointments"]],
  "appointment.moved": [["miniapp", "appointments"]],
  "queue.updated": [["miniapp", "appointments"]],
  "notification.sent": [["miniapp", "inbox"]],
  "notification.read": [["miniapp", "inbox"]],
  "patient.profileUpdated": [["miniapp", "profile"]],
  "patient.familyLinked": [["miniapp", "family"]],
  "patient.familyUnlinked": [["miniapp", "family"]],
  "nps.submitted": [
    ["miniapp", "nps"],
    ["miniapp", "appointments"],
  ],
  "previsit.submitted": [
    ["miniapp", "pre-visit"],
    ["miniapp", "appointments"],
  ],
  "payment.paid": [["miniapp", "documents"]],
  "eprescription.issued": [["miniapp", "medications"]],
  "eprescription.cancelled": [["miniapp", "medications"]],
  "prescription.created": [["miniapp", "medications"]],
  // Schedule change invalidates every cached slot query — the user may have
  // been mid-booking and the picker needs to redraw with the new availability.
  "doctor.scheduleChanged": [["miniapp", "slots"]],
};

const LAST_EVENT_ID_KEY = "miniapp:sse:lastEventId";

function readLastEventId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(LAST_EVENT_ID_KEY);
  } catch {
    return null;
  }
}

function writeLastEventId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(LAST_EVENT_ID_KEY, id);
  } catch {
    /* sessionStorage may be disabled — silently degrade */
  }
}

function clearLastEventId(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(LAST_EVENT_ID_KEY);
  } catch {
    /* ignore */
  }
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof EventSource !== "undefined";
}

function isTestEnv(): boolean {
  if (typeof process === "undefined") return false;
  return process.env?.NODE_ENV === "test" || Boolean(process.env?.VITEST);
}

export function useMiniAppLiveEvents(): void {
  const qc = useQueryClient();
  const { state, initData, clinicSlug } = useMiniAppAuth();
  const ready = state.status === "ready";

  React.useEffect(() => {
    if (!ready) return;
    if (!isBrowser() || isTestEnv()) return;

    // Build the connect URL. `initData` is signed and short-lived, so
    // shipping it in the query string is fine for the SSE handshake.
    const params = new URLSearchParams({ clinicSlug });
    if (initData) params.set("initData", initData);
    const stash = readLastEventId();
    if (stash) params.set("since", stash);
    const url = `/api/miniapp/events?${params.toString()}`;

    const es = new EventSource(url, { withCredentials: true });

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

      // Persist Last-Event-ID for cold reconnects. The browser EventSource
      // already echoes it on warm reconnects via the Last-Event-ID header.
      const eventId = (parsed as { eventId?: string } | null)?.eventId;
      if (eventId) writeLastEventId(eventId);

      dispatchInvalidation(qc, event);
    };

    es.onerror = () => {
      // Browser auto-reconnects with backoff. We only handle the explicit
      // `: cursor-too-old\n\n` sentinel, which the browser surfaces as an
      // `onerror` with `readyState === EventSource.CLOSED` — at which point
      // we wipe the cache so the next refetch grabs the truth.
      if (es.readyState === EventSource.CLOSED) {
        clearLastEventId();
        qc.invalidateQueries({ queryKey: ["miniapp"] });
      }
    };

    return () => {
      try {
        es.close();
      } catch {
        /* ignore */
      }
    };
  }, [ready, qc, initData, clinicSlug]);
}

function dispatchInvalidation(
  qc: ReturnType<typeof useQueryClient>,
  event: AppEvent,
): void {
  const prefixes = MINIAPP_INVALIDATION_MAP[event.type];
  if (!prefixes) return;
  for (const prefix of prefixes) {
    qc.invalidateQueries({ queryKey: prefix });
  }
}

/** Test-only: expose the map so unit tests can assert the wiring. */
export { MINIAPP_INVALIDATION_MAP };
