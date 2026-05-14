"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

import { conversationMessagesKey } from "./use-conversation-messages";
import type {
  ConversationChannel,
  ConversationsFilters,
} from "./use-conversations";

type MessagesContextValue = {
  filters: ConversationsFilters;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setQ: (q: string) => void;
  setChannel: (c: ConversationChannel | "all") => void;
  setUnread: (v: boolean) => void;
};

const MessagesContext = React.createContext<MessagesContextValue | null>(null);

export function MessagesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [channel, setChannelState] = React.useState<
    ConversationChannel | "all"
  >("all");
  const [unread, setUnread] = React.useState(false);

  const [debouncedQ, setDebouncedQ] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Realtime — invalidate the conversation list and the open thread's
  // messages whenever a new TG/SMS message arrives or a conversation's
  // mode/assignment changes. The /api/events SSE endpoint already
  // publishes these for the doctor's clinic.
  useLiveQueryInvalidation({
    events: ["tg.message.new", "tg.conversation.updated"],
    queryKey: ["doctor", "me", "conversations"],
  });
  useLiveQueryInvalidation({
    events: ["tg.message.new"],
    queryKey: (event) =>
      event.type === "tg.message.new"
        ? conversationMessagesKey(event.payload.conversationId)
        : null,
  });

  // Deep-link autoselect: when the messages page is opened with
  // `?patientId=<id>` (e.g. from the patients table «Написать» button or
  // the patient detail page), resolve that patient to a conversation via
  // the find-or-create endpoint and select it. The patientId param is then
  // stripped from the URL so a manual reselect doesn't keep reopening the
  // same thread.
  const searchParams = useSearchParams();
  const router = useRouter();
  const autoselectedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const patientId = searchParams.get("patientId");
    if (!patientId) return;
    if (autoselectedRef.current === patientId) return;
    autoselectedRef.current = patientId;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          "/api/crm/doctors/me/conversations/find-or-create",
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patientId }),
          },
        );
        if (cancelled) return;
        if (res.status === 422) {
          toast.error("Нет канала связи с пациентом", {
            description: "Добавьте телефон или Telegram, чтобы написать.",
          });
          return;
        }
        if (!res.ok) {
          toast.error("Не удалось открыть чат");
          return;
        }
        const data = (await res.json()) as { conversationId: string };
        if (cancelled) return;
        setSelectedId(data.conversationId);
      } catch {
        if (!cancelled) toast.error("Не удалось открыть чат");
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams.toString());
          next.delete("patientId");
          const qs = next.toString();
          router.replace(qs ? `?${qs}` : "?", { scroll: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, router]);

  const value = React.useMemo<MessagesContextValue>(
    () => ({
      filters: {
        q: debouncedQ.trim() ? debouncedQ.trim() : undefined,
        channel: channel === "all" ? undefined : channel,
        unread: unread || undefined,
      },
      selectedId,
      setSelectedId,
      setQ,
      setChannel: (c) => setChannelState(c),
      setUnread,
    }),
    [debouncedQ, channel, unread, selectedId],
  );

  return (
    <MessagesContext.Provider value={value}>
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessagesContext(): MessagesContextValue {
  const ctx = React.useContext(MessagesContext);
  if (!ctx) {
    throw new Error("useMessagesContext must be used inside <MessagesProvider>");
  }
  return ctx;
}
