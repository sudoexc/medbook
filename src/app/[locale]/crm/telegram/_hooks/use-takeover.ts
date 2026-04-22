"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ConversationListResponse, InboxConversation } from "./types";

/**
 * Toggle Conversation.mode between `bot` and `takeover` with an optimistic
 * update that survives the list refetch cycle.
 *
 * Also supports `markRead: true` to zero out `unreadCount` when the operator
 * focuses a chat. The server-side PATCH endpoint accepts either field.
 */

export type TakeoverInput = {
  conversationId: string;
  mode: "bot" | "takeover";
};

export function useTakeover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TakeoverInput): Promise<InboxConversation> => {
      const res = await fetch(`/api/crm/conversations/${input.conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: input.mode }),
      });
      if (!res.ok) throw new Error(`Takeover failed: ${res.status}`);
      return (await res.json()) as InboxConversation;
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["tg-conversations"] });
      // Walk every matching cache and flip mode in-place.
      const snapshots: Array<[readonly unknown[], unknown]> = [];
      qc.getQueriesData<{ pages: ConversationListResponse[] }>({
        queryKey: ["tg-conversations"],
      }).forEach(([key, data]) => {
        snapshots.push([key, data]);
        if (!data) return;
        const pages = data.pages.map((p) => ({
          ...p,
          rows: p.rows.map((r) =>
            r.id === input.conversationId ? { ...r, mode: input.mode } : r,
          ),
        }));
        qc.setQueryData(key, { ...data, pages });
      });
      return { snapshots };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.snapshots) {
        for (const [key, data] of ctx.snapshots) qc.setQueryData(key, data);
      }
      toast.error(err instanceof Error ? err.message : "Takeover failed");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tg-conversations"] });
    },
  });
}
