"use client";

import * as React from "react";
import {
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useLiveEvents } from "@/hooks/use-live-events";

import type { InboxMessage, MessagesResponse } from "./types";

/**
 * Chat history with scroll-up pagination. The list endpoint returns
 * messages newest-first, so we reverse pages for display.
 *
 * Polling: 10s on the active chat (fallback until SSE lands).
 *
 * TODO(realtime-engineer): subscribe to `tg.message.new` and call
 * `queryClient.setQueryData(messagesKey(conversationId), ...)` to append
 * the new message in-place instead of re-fetching.
 */

export function messagesKey(conversationId: string) {
  return ["tg-messages", conversationId] as const;
}

async function fetchMessages(
  conversationId: string,
  cursor: string | null,
): Promise<MessagesResponse> {
  const sp = new URLSearchParams();
  sp.set("limit", "50");
  if (cursor) sp.set("cursor", cursor);
  const res = await fetch(
    `/api/crm/conversations/${conversationId}/messages?${sp.toString()}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Messages load failed: ${res.status}`);
  return (await res.json()) as MessagesResponse;
}

export function useTgMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: conversationId ? messagesKey(conversationId) : ["tg-messages", "none"],
    queryFn: ({ pageParam }) =>
      fetchMessages(conversationId!, pageParam ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(conversationId),
    staleTime: 5_000,
    refetchInterval: conversationId ? 60_000 : false,
  });
}

/**
 * Invalidate the active chat on every `tg.message.new` whose payload
 * matches the selected conversation id.
 */
export function useTgMessagesRealtime(conversationId: string | null): void {
  const qc = useQueryClient();
  useLiveEvents(
    (event) => {
      if (!conversationId) return;
      if (event.type !== "tg.message.new") return;
      const payloadConv = event.payload.conversationId;
      if (payloadConv !== conversationId) return;
      void qc.invalidateQueries({ queryKey: messagesKey(conversationId) });
    },
    { filter: ["tg.message.new"], enabled: Boolean(conversationId) },
  );
}

/**
 * Assemble a flat oldest→newest list from infinite-query pages.
 */
export function flattenMessages(pages: MessagesResponse[] | undefined): InboxMessage[] {
  if (!pages) return [];
  const out: InboxMessage[] = [];
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i]!;
    // Each page is newest-first; reverse to get oldest-first within page.
    for (let j = p.rows.length - 1; j >= 0; j--) {
      out.push(p.rows[j]!);
    }
  }
  return out;
}

/** Invalidation helper used after sending a message. */
export function useInvalidateMessages(conversationId: string | null) {
  const qc = useQueryClient();
  return React.useCallback(() => {
    if (!conversationId) return;
    void qc.invalidateQueries({ queryKey: messagesKey(conversationId) });
  }, [qc, conversationId]);
}
