"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

export type MiniAppConversation = {
  id: string;
  channel: "SMS" | "TG" | "CALL" | "EMAIL" | "VISIT" | "INAPP";
  mode: "bot" | "takeover" | string;
  status: "OPEN" | "SNOOZED" | "CLOSED" | string;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  assignedTo: { id: string; name: string | null } | null;
};

export function useConversations() {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppConversation[]>({
    queryKey: ["miniapp", "conversations", clinicSlug],
    queryFn: async () => {
      const body = await request<{ conversations: MiniAppConversation[] }>(
        "/api/miniapp/conversations",
      );
      return body.conversations;
    },
  });
}

export type FindOrCreateConversationResult = {
  conversationId: string;
  channel: string;
  created: boolean;
};

/**
 * Imperative mutation that opens (or returns) the patient's thread with the
 * clinic. Mini App calls this when the user taps "Чат с клиникой" and again
 * when the messages screen mounts — the helper is idempotent, so re-calling
 * is cheap and the response carries `created: false` when a thread already
 * existed.
 */
export function useOpenConversation() {
  const { request, clinicSlug } = useMiniAppFetch();
  const qc = useQueryClient();
  return useMutation<FindOrCreateConversationResult, Error, void>({
    mutationFn: async () => {
      return request<FindOrCreateConversationResult>(
        "/api/miniapp/conversations/find-or-create",
        { method: "POST" },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["miniapp", "conversations", clinicSlug] });
    },
  });
}
