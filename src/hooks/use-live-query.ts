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
 * Subscribe to SSE events and invalidate the listed query keys on match.
 * The invalidation is async-fire-and-forget (we never block the event
 * loop). TanStack Query will refetch active queries automatically.
 */
export function useLiveQueryInvalidation(
  opts: UseLiveQueryInvalidationOptions,
): void {
  const { events, queryKey, queryKeys, shouldInvalidate, enabled = true } = opts;
  const qc = useQueryClient();

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
        void qc.invalidateQueries({ queryKey: k });
      }
    },
    [qc, queryKey, queryKeys, shouldInvalidate],
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
