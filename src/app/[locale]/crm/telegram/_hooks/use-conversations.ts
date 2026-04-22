"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";

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
 *  - unread       — "1" to restrict to unread
 *  - conv         — selected conversation id (managed by page client)
 *
 * Polling is 30s (the active chat polls faster in its own hook). Once
 * SSE `tg.message.new` lands, these intervals go away.
 */
export type ConversationFilters = {
  q: string;
  mode: ModeFilter;
  unreadOnly: boolean;
};

export function useConversationsFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters: ConversationFilters = React.useMemo(() => {
    const m = (searchParams?.get("mode") ?? "all") as ModeFilter;
    return {
      q: searchParams?.get("q") ?? "",
      mode: m === "bot" || m === "takeover" ? m : "all",
      unreadOnly: searchParams?.get("unread") === "1",
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
      if (patch.unreadOnly !== undefined) {
        if (patch.unreadOnly) sp.set("unread", "1");
        else sp.delete("unread");
      }
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return { filters, setFilters };
}

export function useSelectedConversationId(): [string | null, (id: string | null) => void] {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams?.get("conv") ?? null;
  const setId = React.useCallback(
    (next: string | null) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
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
  if (filters.unreadOnly) sp.set("unread", "1");
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
    // TODO(realtime-engineer): replace with SSE invalidation on `tg.message.new`.
    refetchInterval: 30_000,
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
