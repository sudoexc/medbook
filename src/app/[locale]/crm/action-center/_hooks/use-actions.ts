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
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";
import type { ActionPayload, ActionSeverity, ActionStatus, ActionType } from "@/lib/actions/types";
// Type-only: the wire shape of GET /api/crm/actions/summary.
import type { ActionsSummary } from "@/server/actions/summary";

export type { ActionsSummary };

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
  /** When the row last became actionable; the list is ordered by it. */
  surfacedAt: string;
};

/**
 * A snoozed row comes back by the clock, not by an event: nothing publishes
 * `action.updated` when its timer runs out. Screens that stay open all day
 * (reception briefing, Action Center) poll so it actually reappears.
 */
export const ACTIONS_LIST_POLL_MS = 60_000;

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
 * Single page (cursor=null) fetch with live invalidation, for surfaces that
 * only ever want the top N (the reception briefing). The Action Center pages
 * through everything with `useActionsPaged`.
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
    refetchInterval: ACTIONS_LIST_POLL_MS,
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
 * The Action Center's paged work list: the first page, then more on demand
 * through the list's cursor (audit AC-18: the center used to hold one page of
 * 50 and never asked for the next, so tasks past it were unreachable).
 *
 * An infinite query keeps every loaded page under one cache entry. A poll or
 * an SSE invalidation refetches all loaded pages in order from the top, so a
 * task that came back from a snooze shows up and a closed one drops out, and
 * the optimistic removal below edits the same entry (the old hand-rolled
 * accumulator kept closed rows on screen once a second page was loaded).
 */
export function useActionsPaged(filters: ListActionsFilters) {
  const query = useInfiniteQuery<
    ListActionsPage,
    Error,
    InfiniteData<ListActionsPage, string | null>,
    QueryKey,
    string | null
  >({
    queryKey: [...actionsListKey(filters), "paged"],
    initialPageParam: null,
    queryFn: async ({ pageParam, signal }) => {
      const qs = buildQueryString(filters, pageParam);
      const res = await fetch(`/api/crm/actions${qs ? `?${qs}` : ""}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ListActionsPage;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
    refetchInterval: ACTIONS_LIST_POLL_MS,
  });

  useLiveQueryInvalidation({
    events: ["action.created", "action.updated"],
    queryKey: ["actions"],
  });

  // A row that moved between two pages while they were refetched one after
  // the other must not render twice.
  const rows = React.useMemo(() => {
    const seen = new Set<string>();
    const out: ActionRow[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const r of page.rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    }
    return out;
  }, [query.data]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const loadMore = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return {
    rows,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isLoadingMore: isFetchingNextPage,
    error: query.error,
    hasMore: Boolean(hasNextPage),
    loadMore,
    refetch: query.refetch,
  };
}

/**
 * Server-side aggregate of every visible open task (audit AC-18). The KPI
 * tiles and counters read this, never the loaded pages, so they stay right
 * however few pages the user has opened.
 */
export function useActionsSummary() {
  const query = useQuery<ActionsSummary, Error>({
    queryKey: ["actions", "summary"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/actions/summary`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ActionsSummary;
    },
    staleTime: 15_000,
    refetchInterval: ACTIONS_LIST_POLL_MS,
  });
  useLiveQueryInvalidation({
    events: ["action.created", "action.updated"],
    queryKey: ["actions"],
  });
  return query;
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
  // queryKey. We iterate matched queries and rewrite their data: a single
  // page (`{ rows }`) or the Action Center's paged list (`{ pages }`).
  const queries = qc.getQueriesData<unknown>({ queryKey: ["actions"] });
  for (const [key, data] of queries) {
    if (!data || typeof data !== "object") continue;
    if ("rows" in (data as Record<string, unknown>)) {
      const page = data as ListActionsPage;
      qc.setQueryData<ListActionsPage>(key, {
        ...page,
        rows: page.rows.filter((r) => r.id !== id),
      });
    } else if ("pages" in (data as Record<string, unknown>)) {
      const paged = data as InfiniteData<ListActionsPage, string | null>;
      qc.setQueryData<InfiniteData<ListActionsPage, string | null>>(key, {
        ...paged,
        pages: paged.pages.map((p) => ({
          ...p,
          rows: p.rows.filter((r) => r.id !== id),
        })),
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

// ────────────────────────────────────────────────────────────────────────
// SLA — response-time aggregates for the right-rail tile.
// ────────────────────────────────────────────────────────────────────────

type SlaBucket = { avgSeconds: number | null; samples: number };
export type SlaResponse = {
  windowDays: number;
  overall: SlaBucket;
  telegram: SlaBucket;
  feedback: SlaBucket;
  calls: SlaBucket;
};

export function useActionsSla() {
  return useQuery<SlaResponse>({
    queryKey: ["actions", "sla"],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/actions/sla`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`sla.http.${res.status}`);
      return (await res.json()) as SlaResponse;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
