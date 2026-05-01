"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { InboxMessage, MessagesResponse } from "./types";
import { messagesKey } from "./use-tg-messages";

export type ChatAttachment = {
  kind: "image";
  url: string;
  mimeType: string;
  sizeBytes?: number;
  name?: string;
  width?: number;
  height?: number;
};

export type SendPayload = {
  conversationId: string;
  body: string;
  buttons?: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
  replyToId?: string | null;
  attachments?: ChatAttachment[];
};

/**
 * Optimistic send. Adds a temp OUT row to the top page in cache; on
 * success, invalidates to re-fetch. On error, shows toast + rollback.
 */
export function useSendMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: SendPayload): Promise<InboxMessage> => {
      const res = await fetch(
        `/api/crm/conversations/${payload.conversationId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            body: payload.body,
            buttons: payload.buttons ?? undefined,
            replyToId: payload.replyToId ?? undefined,
            attachments:
              payload.attachments && payload.attachments.length > 0
                ? payload.attachments
                : undefined,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Send failed: ${res.status}`);
      }
      return (await res.json()) as InboxMessage;
    },

    onMutate: async (payload) => {
      const key = messagesKey(payload.conversationId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ pages: MessagesResponse[] }>(key);
      const optimistic: InboxMessage = {
        id: `tmp-${Date.now()}`,
        conversationId: payload.conversationId,
        direction: "OUT",
        body: payload.body,
        attachments:
          payload.attachments && payload.attachments.length > 0
            ? payload.attachments
            : null,
        buttons: payload.buttons ?? null,
        senderId: null,
        sender: null,
        status: "QUEUED",
        externalId: null,
        replyToId: payload.replyToId ?? null,
        createdAt: new Date().toISOString(),
      };
      if (prev) {
        const pages = [...prev.pages];
        const first = pages[0];
        if (first) {
          pages[0] = {
            ...first,
            rows: [optimistic, ...first.rows],
          };
        }
        qc.setQueryData(key, { ...prev, pages });
      }
      return { prev };
    },

    onError: (err, payload, ctx) => {
      const key = messagesKey(payload.conversationId);
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Send failed");
    },

    onSuccess: (_data, payload) => {
      void qc.invalidateQueries({
        queryKey: messagesKey(payload.conversationId),
      });
      void qc.invalidateQueries({
        queryKey: ["tg-conversations"],
      });
    },
  });
}

export function useSendTextCallback(
  conversationId: string | null,
): [
  (body: string) => Promise<void>,
  { isPending: boolean },
] {
  const send = useSendMessage();
  const fn = React.useCallback(
    async (body: string) => {
      if (!conversationId) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      await send.mutateAsync({ conversationId, body: trimmed });
    },
    [conversationId, send],
  );
  return [fn, { isPending: send.isPending }];
}
