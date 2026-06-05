"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

export type MiniAppMessage = {
  id: string;
  direction: "IN" | "OUT";
  body: string | null;
  attachments?: unknown;
  status: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | string;
  createdAt: string;
  senderId: string | null;
  sender?: { id: string; name: string | null } | null;
};

type ListResponse = { messages: MiniAppMessage[]; nextCursor: string | null };

/**
 * Fetch a page of messages for one conversation. The server returns rows
 * newest-first (pagination cursor walks back in time); the client flips
 * `.reverse()` for chronological rendering, matching the doctor inbox.
 *
 * Polling: the patient screen subscribes to the standard `/api/events` SSE
 * via `useMiniAppLiveEvents`, so this query stays cache-only until something
 * invalidates it (e.g. a `tg.message.new` SSE wake-up).
 */
export function useConversationMessages(conversationId: string | null) {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppMessage[]>({
    queryKey: ["miniapp", "messages", clinicSlug, conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const body = await request<ListResponse>(
        `/api/miniapp/conversations/${conversationId}/messages`,
        { searchParams: { limit: "50" } },
      );
      return [...body.messages].reverse();
    },
  });
}

export function useSendMessage(conversationId: string | null) {
  const { request, clinicSlug } = useMiniAppFetch();
  const qc = useQueryClient();
  return useMutation<MiniAppMessage, Error, { body: string }>({
    mutationFn: async (input) => {
      if (!conversationId) throw new Error("no_conversation");
      const res = await request<{ message: MiniAppMessage }>(
        `/api/miniapp/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: input.body }),
        },
      );
      return res.message;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["miniapp", "messages", clinicSlug, conversationId],
      });
      qc.invalidateQueries({
        queryKey: ["miniapp", "conversations", clinicSlug],
      });
    },
  });
}
