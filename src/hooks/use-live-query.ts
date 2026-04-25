"use client";

/**
 * `useLiveQuery` — a small helper that marries TanStack Query with the SSE
 * event bus. Subscribe to a set of event types; on every matching event,
 * invalidate or setQueryData for the provided query key(s).
 *
 * Shapes supported:
 *
 *   useLiveQueryInvalidation({
 *     events: ["appointment.created", "appointment.moved"],
 *     queryKey: ["calendar", "appointments"],
 *   });
 *
 *   useLiveQueryInvalidation({
 *     events: ["tg.message.new"],
 *     queryKey: (event) => ["tg-messages", event.payload.conversationId],
 *   });
 *
 *   useLiveQueryInvalidation({
 *     events: ["appointment.created"],
 *     queryKeys: [
 *       ["reception", "dashboard"],
 *       ["reception", "appointments", "today"],
 *     ],
 *   });
 *
 * SSR-safe (`useLiveEvents` no-ops on the server), so it's fine to call
 * from any client-rendered component.
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";

import { useLiveEvents } from "./use-live-events";
import type { AppEvent, EventType } from "@/server/realtime/events";

type KeyFactory =
  | QueryKey
  | readonly QueryKey[]
  | ((event: AppEvent) => QueryKey | readonly QueryKey[] | null | undefined);

export type UseLiveQueryInvalidationOptions = {
  events: ReadonlyArray<EventType>;
  /** One query key. */
  queryKey?: QueryKey | ((event: AppEvent) => QueryKey | null | undefined);
  /** Several query keys (static list or factory). */
  queryKeys?: KeyFactory;
  /**
   * Optional predicate to veto an event before invalidation (e.g. filter
   * by payload.doctorId). Runs after the type-level filter.
   */
  shouldInvalidate?: (event: AppEvent) => boolean;
  enabled?: boolean;
};

function isQueryKey(value: unknown): value is QueryKey {
  return Array.isArray(value);
}

function flattenKeys(value: unknown): QueryKey[] {
  if (value == null) return [];
  if (!Array.isArray(value)) return [];
  // readonly QueryKey[] — array of arrays.
  const first = (value as unknown[])[0];
  if (Array.isArray(first)) {
    return (value as unknown[]).filter(isQueryKey) as QueryKey[];
  }
  // QueryKey itself.
  return [value as QueryKey];
}

/**
 * Window inside which incoming events coalesce into a single invalidation
 * per unique query key. SSE events arrive in bursts during peak clinic
 * hours (5+ receptionists × 50+ status changes/day); without coalescing,
 * each event would trigger a refetch round-trip and a re-render across
 * every connected screen.
 *
 * 400ms strikes a balance: too short (≤100ms) and bursts still hammer the
 * API; too long (≥1s) and the UI feels stale to a receptionist who just
 * clicked something.
 */
const SSE_INVALIDATION_DEBOUNCE_MS = 400;

/**
 * Stable JSON key for de-duping QueryKey arrays inside the debounce
 * buffer. QueryKey is a tuple/array, never includes functions, so
 * JSON.stringify is safe and fast.
 */
function stringifyKey(key: QueryKey): string {
  return JSON.stringify(key);
}

/**
 * Subscribe to SSE events and invalidate the listed query keys on match.
 *
 * Invalidations are debounced and de-duplicated: a burst of N events that
 * map to the same query key produces ONE invalidation with ONE refetch.
 * `refetchType: "active"` ensures only currently-mounted screens refetch —
 * stale background queries stay marked but don't fire a network request
 * until they remount.
 */
export function useLiveQueryInvalidation(
  opts: UseLiveQueryInvalidationOptions,
): void {
  const { events, queryKey, queryKeys, shouldInvalidate, enabled = true } = opts;
  const qc = useQueryClient();

  const pendingRef = React.useRef<Map<string, QueryKey>>(new Map());
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const flush = React.useCallback(() => {
    const keys = Array.from(pendingRef.current.values());
    pendingRef.current.clear();
    timerRef.current = null;
    for (const k of keys) {
      void qc.invalidateQueries({ queryKey: k, refetchType: "active" });
    }
  }, [qc]);

  const handler = React.useCallback(
    (event: AppEvent) => {
      if (shouldInvalidate && !shouldInvalidate(event)) return;

      const keys: QueryKey[] = [];
      if (queryKey) {
        if (typeof queryKey === "function") {
          const k = queryKey(event);
          if (k) keys.push(k);
        } else {
          keys.push(queryKey);
        }
      }
      if (queryKeys) {
        if (typeof queryKeys === "function") {
          const k = queryKeys(event);
          keys.push(...flattenKeys(k));
        } else {
          keys.push(...flattenKeys(queryKeys));
        }
      }

      for (const k of keys) {
        pendingRef.current.set(stringifyKey(k), k);
      }

      if (timerRef.current === null) {
        timerRef.current = setTimeout(flush, SSE_INVALIDATION_DEBOUNCE_MS);
      }
    },
    [flush, queryKey, queryKeys, shouldInvalidate],
  );

  useLiveEvents(handler, { filter: events, enabled });
}

/**
 * Thin convenience: subscribe to events of interest and run an arbitrary
 * side-effect. The `useLiveEvents` primitive is still the base layer;
 * re-exported here so all realtime hooks live in one import path.
 */
export function useLiveEventsSubscription(
  events: ReadonlyArray<EventType>,
  onEvent: (event: AppEvent) => void,
  enabled = true,
): void {
  useLiveEvents(onEvent, { filter: events, enabled });
}
