"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { failedReasonText } from "../_lib/failed-reason";
import type { InboxMessage, MessagesResponse } from "./types";
import { messagesKey } from "./use-tg-messages";
import { invalidateConversationCaches } from "./use-conversations";

export type ChatAttachment = {
  kind: "image" | "file";
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

/** The fields of an `UnfilledPlaceholders` refusal, or null for any other error. */
function unfilledFieldsOf(responseText: string): string[] | null {
  try {
    const j = JSON.parse(responseText) as { error?: unknown; fields?: unknown };
    if (j?.error !== "UnfilledPlaceholders" || !Array.isArray(j.fields)) return null;
    return j.fields.filter((f): f is string => typeof f === "string");
  } catch {
    return null;
  }
}

/**
 * Messages this tab sent that the worker has not finished (audit TG-17). The
 * POST only queues a message; SENT or FAILED arrives later on the realtime
 * bus. A failure toasts in the tab that sent it (`useTgInboxAlerts`), not in
 * every operator's.
 */
const pendingSends = new Set<string>();

export function trackPendingSend(messageId: string): void {
  pendingSends.add(messageId);
}

/** Forget a pending send; true when this tab was waiting for it. */
export function settlePendingSend(messageId: string): boolean {
  return pendingSends.delete(messageId);
}

/**
 * Optimistic send. Adds a temp OUT row to the top page in cache; on
 * success, invalidates to re-fetch. On error, shows toast + rollback.
 *
 * Success means «queued» (audit TG-17): the row comes back QUEUED at once
 * and the bubble shows «Отправляется» until the worker reports SENT, or
 * «Не доставлено» with «Повторить». Nothing here waits for Telegram, so a
 * slow send never looks like a failure worth sending again.
 */
export function useSendMessage() {
  const qc = useQueryClient();
  const t = useTranslations("tgInbox");

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
        // The route refuses a text still carrying template fields (audit
        // G6-04): say which, instead of a raw JSON error.
        const unfilled = unfilledFieldsOf(text);
        if (unfilled) {
          throw new Error(
            t("message.unfilledPlaceholders", {
              fields: unfilled.map((f) => `{{${f}}}`).join(", "),
            }),
          );
        }
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

    onSuccess: (data, payload) => {
      // The row is saved either way; say so when it cannot go out at all
      // (no bot, no Telegram), rather than leaving a quiet red mark (audit
      // TG-04). A queued row reports later.
      if (data?.status === "FAILED") {
        toast.error(
          t("message.failed.toast", {
            reason: failedReasonText(t, data.failedReason),
          }),
        );
      } else if (data?.id) {
        trackPendingSend(data.id);
      }
      void qc.invalidateQueries({
        queryKey: messagesKey(payload.conversationId),
      });
      invalidateConversationCaches(qc);
    },
  });
}

/**
 * «Повторить» on a staff message that did not reach the patient (audit
 * TG-17): the same row goes back to the queue.
 */
export function useRetryMessage() {
  const qc = useQueryClient();
  const t = useTranslations("tgInbox");

  return useMutation({
    mutationFn: async (m: {
      conversationId: string;
      messageId: string;
    }): Promise<InboxMessage> => {
      const res = await fetch(
        `/api/crm/conversations/${m.conversationId}/messages/${m.messageId}/retry`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        throw new Error(t("message.retryFailed"));
      }
      return (await res.json()) as InboxMessage;
    },
    onSuccess: (data, m) => {
      if (data?.status === "FAILED") {
        toast.error(
          t("message.failed.toast", {
            reason: failedReasonText(t, data.failedReason),
          }),
        );
      } else if (data?.id) {
        trackPendingSend(data.id);
      }
      void qc.invalidateQueries({ queryKey: messagesKey(m.conversationId) });
      invalidateConversationCaches(qc);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("message.retryFailed"));
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
