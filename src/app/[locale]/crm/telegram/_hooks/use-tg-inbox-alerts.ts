"use client";

/**
 * Live alerts for the Telegram inbox.
 *
 * On every `tg.message.new` / `tg.takeover.incoming`:
 *   1. Invalidates the conversations list (replaces the older
 *      `useTgConversationsRealtime` hook — kept colocated with toast/pulse so
 *      a single subscription drives every UI side-effect).
 *   2. Tracks the conversation id in `pulsedIds` for ~3s so the row in
 *      `ConversationList` can briefly highlight via CSS.
 *   3. Fires a sonner toast with the contact name + preview when the
 *      conversation isn't the currently focused one. Active chat doesn't
 *      need a toast — the operator is already looking at it.
 */

import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { useLiveEvents } from "@/hooks/use-live-events";

const PULSE_MS = 2500;

export function useTgInboxAlerts(opts: {
  activeId: string | null;
  onSelect: (id: string) => void;
}): { pulsedIds: ReadonlySet<string> } {
  const { activeId, onSelect } = opts;
  const t = useTranslations("tgInbox");
  const qc = useQueryClient();

  const [pulsedIds, setPulsedIds] = React.useState<Set<string>>(() => new Set());

  const activeIdRef = React.useRef(activeId);
  const onSelectRef = React.useRef(onSelect);
  React.useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  React.useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useLiveEvents(
    (event) => {
      // Always refresh the list on any tg.* event so mode/status flips and
      // assignee changes propagate without a manual reload.
      void qc.invalidateQueries({ queryKey: ["tg-conversations"] });
      // Keep the overview counters fresh when patients link/block via the bot.
      void qc.invalidateQueries({ queryKey: ["tg-stats"] });

      // Toast / pulse only fires for incoming patient activity. Status-only
      // updates (`tg.conversation.updated`) are silent.
      if (
        event.type !== "tg.message.new" &&
        event.type !== "tg.takeover.incoming"
      )
        return;

      const conversationId = event.payload.conversationId;
      if (!conversationId) return;

      setPulsedIds((prev) => {
        const next = new Set(prev);
        next.add(conversationId);
        return next;
      });
      window.setTimeout(() => {
        setPulsedIds((prev) => {
          if (!prev.has(conversationId)) return prev;
          const next = new Set(prev);
          next.delete(conversationId);
          return next;
        });
      }, PULSE_MS);

      // Skip toast when the operator is already on this chat.
      if (activeIdRef.current === conversationId) return;

      // Outgoing messages (operator replies surfaced via Redis fan-out from
      // another tab) don't need a toast — the sender already saw it.
      if (
        event.type === "tg.message.new" &&
        event.payload.direction === "OUT"
      ) {
        return;
      }

      const payload = event.payload as {
        contactName?: string | null;
        preview?: string;
      };
      const name = payload.contactName?.trim() || t("alerts.fallbackName");
      const preview = payload.preview?.trim() ?? "";
      const description = preview ? `${name}: ${preview}` : name;

      toast(t("alerts.newMessage"), {
        description,
        action: {
          label: t("alerts.open"),
          onClick: () => onSelectRef.current(conversationId),
        },
      });
    },
    {
      filter: [
        "tg.message.new",
        "tg.takeover.incoming",
        "tg.conversation.updated",
      ],
    },
  );

  return { pulsedIds };
}
