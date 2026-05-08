"use client";

/**
 * Data hooks for the Action Center surfaces. Wraps `/api/crm/actions` GET +
 * the four mutation routes (`snooze`, `dismiss`, `done`, `reopen`) plus the
 * admin `recompute` endpoint.
 *
 * Live updates: every consumer is invalidated by SSE `action.created` and
 * `action.updated` via `useLiveQueryInvalidation`. The mutations also do
 * optimistic updates so the row disappears the instant the user clicks
 * (rolled back on failure).
 */
import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";
import type { ActionPayload, ActionSeverity, ActionStatus, ActionType } from "@/lib/actions/types";

export type ActionRow = {
  id: string;
  clinicId: string;
  branchId: string | null;
  type: ActionType;
  severity: ActionSeverity;
  payload: ActionPayload;
  status: ActionStatus;
  assigneeRole: "ADMIN" | "RECEPTIONIST" | null;
  deeplinkPath: string | null;
  dedupeKey: string;
  snoozeUntil: string | null;
  dismissedAt: string | null;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

export type ListActionsFilters = {
  status?: ActionStatus[];
  type?: ActionType[];
  severity?: ActionSeverity[];
  assigneeRole?: "ADMIN" | "RECEPTIONIST" | null;
  limit?: number;
};

export type ListActionsPage = {
  rows: ActionRow[];
  nextCursor: string | null;
};

function buildQueryString(filters: ListActionsFilters, cursor?: string | null): string {
  const sp = new URLSearchParams();
  for (const s of filters.status ?? []) sp.append("status", s);
  for (const t of filters.type ?? []) sp.append("type", t);
  for (const sv of filters.severity ?? []) sp.append("severity", sv);
  if (filters.assigneeRole) sp.set("assigneeRole", filters.assigneeRole);
  if (filters.limit != null) sp.set("limit", String(filters.limit));
  if (cursor) sp.set("cursor", cursor);
  return sp.toString();
}

export function actionsListKey(filters: ListActionsFilters): QueryKey {
  return [
    "actions",
    "list",
    {
      status: filters.status ?? null,
      type: filters.type ?? null,
      severity: filters.severity ?? null,
      assigneeRole: filters.assigneeRole ?? null,
      limit: filters.limit ?? null,
    },
  ];
}

/**
 * Single page (cursor=null) fetch with live invalidation. Pagination — when we
 * need it — is handled by holding an array of pages in component state and
 * calling `fetchNextPage`. We deliberately don't use `useInfiniteQuery` here:
 * the optimistic-update logic for snooze/dismiss/done is already complex
 * enough on a flat list, and most clinics never breach the default 50-row
 * page size.
 */
export function useActionsList(filters: ListActionsFilters) {
  const key = actionsListKey(filters);
  const query = useQuery<ListActionsPage, Error>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const qs = buildQueryString(filters);
      const res = await fetch(`/api/crm/actions${qs ? `?${qs}` : ""}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ListActionsPage;
    },
    staleTime: 15_000,
  });

  // Coarse invalidation: any action.* event invalidates every list query.
  // Filters might no longer match the changed row, but invalidating is cheap
  // (refetch with the same filters); reasoning about which filter set to spare
  // is brittle and not worth the complexity.
  useLiveQueryInvalidation({
    events: ["action.created", "action.updated"],
    queryKey: ["actions"],
  });

  return query;
}

/**
 * Cursor-style "load more" hook. Holds accumulated pages in local state so the
 * underlying tanstack key stays stable as the user pages.
 */
export function useActionsPaged(filters: ListActionsFilters) {
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [accumulated, setAccumulated] = React.useState<ActionRow[]>([]);
  const [hasMore, setHasMore] = React.useState(true);

  const baseKey = actionsListKey(filters);
  const pagedKey = [...baseKey, "page", cursor] as QueryKey;

  const query = useQuery<ListActionsPage, Error>({
    queryKey: pagedKey,
    queryFn: async ({ signal }) => {
      const qs = buildQueryString(filters, cursor);
      const res = await fetch(`/api/crm/actions${qs ? `?${qs}` : ""}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ListActionsPage;
    },
    staleTime: 15_000,
  });

  React.useEffect(() => {
    if (!query.data) return;
    setAccumulated((prev) => {
      if (cursor === null) return query.data!.rows;
      // Avoid duplicate append on React strict-mode double effect.
      const seen = new Set(prev.map((r) => r.id));
      const next = query.data!.rows.filter((r) => !seen.has(r.id));
      return [...prev, ...next];
    });
    setHasMore(Boolean(query.data.nextCursor));
  }, [query.data, cursor]);

  // Reset accumulated when filters change.
  const filtersKey = JSON.stringify(baseKey);
  const lastFiltersRef = React.useRef(filtersKey);
  React.useEffect(() => {
    if (lastFiltersRef.current === filtersKey) return;
    lastFiltersRef.current = filtersKey;
    setCursor(null);
    setAccumulated([]);
    setHasMore(true);
  }, [filtersKey]);

  // Live invalidation. On invalidation we drop the cursor so the list
  // refetches from the start — otherwise newly-created rows wouldn't appear.
  useLiveQueryInvalidation({
    events: ["action.created", "action.updated"],
    queryKey: ["actions"],
  });

  const loadMore = React.useCallback(() => {
    if (query.data?.nextCursor) setCursor(query.data.nextCursor);
  }, [query.data?.nextCursor]);

  return {
    rows: accumulated,
    isLoading: query.isLoading && cursor === null,
    isFetching: query.isFetching,
    error: query.error,
    hasMore,
    loadMore,
    refetch: query.refetch,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────────────────────

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as
      | { error?: string; reason?: string }
      | null;
    throw new Error(data?.reason ?? data?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Optimistic helper: walk every cached `["actions", ...]` query and remove
 * the action with `id`. Used by snooze/dismiss/done so the row vanishes
 * immediately. The query is invalidated on success/settle so the source of
 * truth is the server response.
 */
function removeFromAllListCaches(qc: ReturnType<typeof useQueryClient>, id: string) {
  // Cache structure: tanstack stores entries keyed by JSON-serialised
  // queryKey. We iterate matched queries and rewrite their data.
  const queries = qc.getQueriesData<unknown>({ queryKey: ["actions"] });
  for (const [key, data] of queries) {
    if (!data || typeof data !== "object") continue;
    if ("rows" in (data as Record<string, unknown>)) {
      const page = data as ListActionsPage;
      qc.setQueryData<ListActionsPage>(key, {
        ...page,
        rows: page.rows.filter((r) => r.id !== id),
      });
    }
  }
}

export function useSnoozeAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      preset?: "1h" | "4h" | "tomorrow" | "next-week";
      until?: string;
    }) => {
      const body = input.preset
        ? { preset: input.preset }
        : { until: input.until };
      return postJson<ActionRow>(`/api/crm/actions/${input.id}/snooze`, body);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["actions"] });
      removeFromAllListCaches(qc, input.id);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useDismissAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) =>
      postJson<ActionRow>(`/api/crm/actions/${input.id}/dismiss`, {
        reason: input.reason,
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["actions"] });
      removeFromAllListCaches(qc, input.id);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useDoneAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) =>
      postJson<ActionRow>(`/api/crm/actions/${input.id}/done`, {}),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["actions"] });
      removeFromAllListCaches(qc, input.id);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useReopenAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) =>
      postJson<ActionRow>(`/api/crm/actions/${input.id}/reopen`, {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export type RecomputeResult = {
  created: number;
  updated: number;
  skipped: number;
  expired: number;
  errors: Array<{ type: string; error: string }>;
};

export function useRecomputeActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<RecomputeResult>(`/api/crm/actions/recompute`, {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}
