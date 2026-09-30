"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { InboxConversation } from "./types";
import {
  invalidateConversationCaches,
  patchConversationCaches,
} from "./use-conversations";

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
      await qc.cancelQueries({ queryKey: ["tg-conversation"] });
      // Snapshot every cache holding the thread (the lists and the single
      // row the inbox opens by id, G6-07), then flip mode in place.
      const snapshots: Array<[readonly unknown[], unknown]> = [
        ...qc.getQueriesData({ queryKey: ["tg-conversations"] }),
        ...qc.getQueriesData({ queryKey: ["tg-conversation"] }),
      ];
      patchConversationCaches(qc, input.conversationId, { mode: input.mode });
      return { snapshots };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.snapshots) {
        for (const [key, data] of ctx.snapshots) qc.setQueryData(key, data);
      }
      toast.error(err instanceof Error ? err.message : "Takeover failed");
    },
    onSuccess: () => {
      invalidateConversationCaches(qc);
    },
  });
}
