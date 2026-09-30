"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useInfiniteQuery,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";

import type {
  ConversationListResponse,
  InboxConversation,
  ModeFilter,
} from "./types";

/**
 * URL-synced filter state for the inbox conversation list.
 *
 * URL keys:
 *  - q            — search
 *  - mode         — bot | takeover | all
 *  - unanswered   — "1": «Неотвеченные», a patient message no staff reply
 *                   followed (audit G6-03). The old `unread=1` links read
 *                   the same way.
 *  - conv         — selected conversation id (managed by page client); `c`
 *                   is read as an alias (the reception widget used it,
 *                   audit G6-07)
 *  - patientId    — scope deep-link from appointments table / patient page
 *                   (no UI chip; persists in URL so back-nav stays in scope)
 *
 * Polling is 30s (the active chat polls faster in its own hook). Once
 * SSE `tg.message.new` lands, these intervals go away.
 */
export type AssigneeFilter = "all" | "mine";

export type ConversationFilters = {
  q: string;
  mode: ModeFilter;
  unanswered: boolean;
  patientId: string | null;
  assignee: AssigneeFilter;
};

export function useConversationsFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters: ConversationFilters = React.useMemo(() => {
    const m = (searchParams?.get("mode") ?? "all") as ModeFilter;
    return {
      q: searchParams?.get("q") ?? "",
      mode: m === "bot" || m === "takeover" ? m : "all",
      unanswered:
        searchParams?.get("unanswered") === "1" ||
        searchParams?.get("unread") === "1",
      patientId: searchParams?.get("patientId") ?? null,
      assignee: searchParams?.get("assignee") === "mine" ? "mine" : "all",
    };
  }, [searchParams]);

  const setFilters = React.useCallback(
    (patch: Partial<ConversationFilters>) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      if (patch.q !== undefined) {
        if (patch.q) sp.set("q", patch.q);
        else sp.delete("q");
      }
      if (patch.mode !== undefined) {
        if (patch.mode === "all") sp.delete("mode");
        else sp.set("mode", patch.mode);
      }
      if (patch.unanswered !== undefined) {
        sp.delete("unread");
        if (patch.unanswered) sp.set("unanswered", "1");
        else sp.delete("unanswered");
      }
      if (patch.patientId !== undefined) {
        if (patch.patientId) sp.set("patientId", patch.patientId);
        else sp.delete("patientId");
      }
      if (patch.assignee !== undefined) {
        if (patch.assignee === "mine") sp.set("assignee", "mine");
        else sp.delete("assignee");
      }
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return { filters, setFilters };
}

/** The selected thread in the URL: `conv`, or the legacy `c` alias. */
export function selectedIdFromParams(
  sp: { get: (key: string) => string | null } | null | undefined,
): string | null {
  return sp?.get("conv") || sp?.get("c") || null;
}

export function useSelectedConversationId(): [string | null, (id: string | null) => void] {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = selectedIdFromParams(searchParams);
  const setId = React.useCallback(
    (next: string | null) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      sp.delete("c");
      if (next) sp.set("conv", next);
      else sp.delete("conv");
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
  return [id, setId];
}

export function conversationsKey(filters: ConversationFilters) {
  return ["tg-conversations", filters] as const;
}

async function fetchConversations(
  filters: ConversationFilters,
  cursor: string | null,
): Promise<ConversationListResponse> {
  const sp = new URLSearchParams();
  sp.set("channel", "TG");
  sp.set("limit", "50");
  if (filters.q) sp.set("q", filters.q);
  if (filters.mode !== "all") sp.set("mode", filters.mode);
  if (filters.unanswered) sp.set("unanswered", "1");
  if (filters.patientId) sp.set("patientId", filters.patientId);
  if (filters.assignee === "mine") sp.set("assignedToId", "me");
  if (cursor) sp.set("cursor", cursor);
  const res = await fetch(`/api/crm/conversations?${sp.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Conversations load failed: ${res.status}`);
  return (await res.json()) as ConversationListResponse;
}

export function useConversations(filters: ConversationFilters) {
  return useInfiniteQuery({
    queryKey: conversationsKey(filters),
    queryFn: ({ pageParam }) => fetchConversations(filters, pageParam ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
    // SSE invalidation (`useTgInboxAlerts`) keeps this fresh on `tg.*`
    // events. 60s polling stays as a safety net.
    refetchInterval: 60_000,
  });
}

/** Flatten infinite-query pages. */
export function flattenConversations(
  pages: ConversationListResponse[] | undefined,
): InboxConversation[] {
  if (!pages) return [];
  const out: InboxConversation[] = [];
  for (const p of pages) out.push(...p.rows);
  return out;
}

/**
 * One thread by id (audit G6-07). The inbox shows the selected thread even
 * when it is not on the loaded page of the list or outside the active tab: a
 * link from the reception widget, the search or a toast, and the thread that
 * leaves «Неотвеченные» the moment the operator answers it. Its own key
 * prefix: the list caches are paged, this one is a single row.
 */
export function conversationKey(id: string) {
  return ["tg-conversation", id] as const;
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: id ? conversationKey(id) : ["tg-conversation", "none"],
    queryFn: async ({ signal }): Promise<InboxConversation | null> => {
      const res = await fetch(`/api/crm/conversations/${encodeURIComponent(id!)}`, {
        credentials: "include",
        signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Conversation load failed: ${res.status}`);
      return (await res.json()) as InboxConversation;
    },
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

/**
 * Which thread the chat pane shows: the list row when it is loaded (the
 * freshest), else the one fetched by id, else the one shown a moment ago
 * while its own fetch is in flight, so answering a thread in «Неотвеченные»
 * does not blank the chat for a round trip. Never another thread than
 * `selectedId`, and nothing without a selection (no auto-open).
 */
export function pickSelectedConversation(input: {
  selectedId: string | null;
  rows: InboxConversation[];
  fetched: InboxConversation | null | undefined;
  previous: InboxConversation | null;
}): InboxConversation | null {
  const { selectedId, rows, fetched, previous } = input;
  if (!selectedId) return null;
  const fromList = rows.find((r) => r.id === selectedId);
  if (fromList) return fromList;
  if (fetched && fetched.id === selectedId) return fetched;
  if (fetched === undefined && previous?.id === selectedId) return previous;
  return null;
}

/**
 * Patch one thread in every cache that holds it: the paged lists and the
 * single-row query.
 */
export function patchConversationCaches(
  qc: QueryClient,
  id: string,
  patch: Partial<InboxConversation>,
): void {
  qc.getQueriesData<{ pages: ConversationListResponse[] }>({
    queryKey: ["tg-conversations"],
  }).forEach(([key, data]) => {
    if (!data?.pages) return;
    const pages = data.pages.map((p) => ({
      ...p,
      rows: p.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
    qc.setQueryData(key, { ...data, pages });
  });
  const one = qc.getQueryData<InboxConversation | null>(conversationKey(id));
  if (one) qc.setQueryData(conversationKey(id), { ...one, ...patch });
}

/** Refetch the lists and the single-row caches. */
export function invalidateConversationCaches(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["tg-conversations"] });
  void qc.invalidateQueries({ queryKey: ["tg-conversation"] });
}
