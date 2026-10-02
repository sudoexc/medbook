"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { shellSummaryKey } from "@/hooks/use-shell-summary";

import {
  invalidateConversationCaches,
  patchConversationCaches,
} from "./use-conversations";

/**
 * Zero out `unreadCount` for the focused conversation. We only call the
 * server when the cached count is non-zero so re-renders don't spam the API.
 *
 * The cache is patched optimistically in every list and single-thread cache
 * so the badge disappears immediately. Reading never answers: the thread
 * stays in «Неотвеченные» (audit G6-03).
 */
export function useMarkConversationRead() {
  const qc = useQueryClient();
  const inFlight = React.useRef<Set<string>>(new Set());

  return useMutation({
    mutationFn: async (conversationId: string): Promise<void> => {
      const res = await fetch(`/api/crm/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ markRead: true }),
      });
      if (!res.ok) throw new Error(`mark-read failed: ${res.status}`);
    },
    onMutate: async (conversationId) => {
      inFlight.current.add(conversationId);
      patchConversationCaches(qc, conversationId, { unreadCount: 0 });
    },
    onSettled: (_data, _err, conversationId) => {
      inFlight.current.delete(conversationId);
      invalidateConversationCaches(qc);
      void qc.invalidateQueries({ queryKey: ["reception", "conversations"] });
      // The sidebar badge reads `shellSummaryKey` (["crm", "shell-summary"]);
      // a bare ["shell-summary"] matched nothing, so the badge kept its old
      // count until the next refetch (audit AN-32).
      void qc.invalidateQueries({ queryKey: shellSummaryKey });
    },
  });
}

/**
 * «Ответ не нужен»: the patient's last message («Спасибо!») needs no answer,
 * so the thread leaves «Неотвеченные» without a reply (audit G6-03).
 */
export function useMarkConversationAnswered() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string): Promise<void> => {
      const res = await fetch(`/api/crm/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ markAnswered: true }),
      });
      if (!res.ok) throw new Error(`mark-answered failed: ${res.status}`);
    },
    onMutate: async (conversationId) => {
      patchConversationCaches(qc, conversationId, { awaitingReplySince: null });
    },
    onSettled: () => {
      invalidateConversationCaches(qc);
    },
  });
}
