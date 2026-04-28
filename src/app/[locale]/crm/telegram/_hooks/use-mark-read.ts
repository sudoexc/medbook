"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ConversationListResponse } from "./types";

/**
 * Zero out `unreadCount` for the focused conversation. We only call the
 * server when the cached count is non-zero so re-renders don't spam the API.
 *
 * The cache is patched optimistically in every `["tg-conversations", …]`
 * query so the badge in the list disappears immediately.
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
      qc.getQueriesData<{ pages: ConversationListResponse[] }>({
        queryKey: ["tg-conversations"],
      }).forEach(([key, data]) => {
        if (!data) return;
        const pages = data.pages.map((p) => ({
          ...p,
          rows: p.rows.map((r) =>
            r.id === conversationId ? { ...r, unreadCount: 0 } : r,
          ),
        }));
        qc.setQueryData(key, { ...data, pages });
      });
    },
    onSettled: (_data, _err, conversationId) => {
      inFlight.current.delete(conversationId);
      void qc.invalidateQueries({ queryKey: ["tg-conversations"] });
      void qc.invalidateQueries({ queryKey: ["reception", "conversations"] });
      void qc.invalidateQueries({ queryKey: ["shell-summary"] });
    },
  });
}
