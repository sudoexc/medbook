"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ClockIcon,
  InfoIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  SendIcon,
  StarIcon,
  XOctagonIcon,
} from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { useLiveEvents } from "@/hooks/use-live-events";
import { cn } from "@/lib/utils";

import { useMessagesContext } from "../_hooks/messages-context";
import {
  conversationInitials,
  conversationTitle,
  doctorConversationsKey,
  flattenConversations,
  useDoctorConversations,
  type ConversationRow,
} from "../_hooks/use-conversations";
import {
  conversationMessagesKey,
  flattenMessagesAsc,
  useConversationMessages,
  type MessageRow,
  type MessageStatus,
} from "../_hooks/use-conversation-messages";

export function ChatPanel() {
  const { filters, selectedId } = useMessagesContext();
  const queryClient = useQueryClient();
  const convQuery = useDoctorConversations(filters);
  const conversations = flattenConversations(convQuery.data);
  const selected =
    conversations.find((c) => c.id === selectedId) ?? null;

  const messagesQuery = useConversationMessages(selectedId);
  const messages = flattenMessagesAsc(messagesQuery.data);

  // Live updates: refetch on tg.message.new for the active conversation, and
  // invalidate the thread list (last preview, unread count, ordering).
  useLiveEvents(
    React.useCallback(
      (event) => {
        if (event.type !== "tg.message.new") return;
        if (
          selectedId &&
          event.payload.conversationId === selectedId
        ) {
          queryClient.invalidateQueries({
            queryKey: conversationMessagesKey(selectedId),
          });
        }
        queryClient.invalidateQueries({
          queryKey: doctorConversationsKey(filters),
        });
      },
      [queryClient, selectedId, filters],
    ),
    { filter: ["tg.message.new"] },
  );

  // Auto-scroll to bottom when messages list changes.
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedId]);

  // Mark as read when opening (PATCH markRead).
  React.useEffect(() => {
    if (!selectedId) return;
    if (!selected || selected.unreadCount === 0) return;
    void fetch(`/api/crm/conversations/${selectedId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markRead: true }),
    }).then(() => {
      queryClient.invalidateQueries({
        queryKey: doctorConversationsKey(filters),
      });
    });
    // We only mark on open / unread change, not on every filter render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.unreadCount]);

  if (!selectedId || !selected) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center rounded-2xl border border-border bg-card">
        <div className="text-sm text-muted-foreground">
          Выберите диалог слева
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-border bg-card">
      <ChatHeader conv={selected} />

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-5"
      >
        {messagesQuery.isLoading ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            Загружаем сообщения…
          </div>
        ) : messagesQuery.isError ? (
          <div className="px-2 py-6 text-center text-sm text-destructive">
            Не удалось загрузить сообщения
          </div>
        ) : messages.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            Сообщений пока нет
          </div>
        ) : (
          <>
            {messagesQuery.hasNextPage ? (
              <div className="mb-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => messagesQuery.fetchNextPage()}
                  disabled={messagesQuery.isFetchingNextPage}
                  className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {messagesQuery.isFetchingNextPage
                    ? "Загрузка…"
                    : "Показать историю выше"}
                </button>
              </div>
            ) : null}
            <ul className="space-y-3">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const showSeparator =
                  !prev ||
                  new Date(m.createdAt).toDateString() !==
                    new Date(prev.createdAt).toDateString();
                return (
                  <React.Fragment key={m.id}>
                    {showSeparator ? (
                      <DaySeparator date={new Date(m.createdAt)} />
                    ) : null}
                    <MessageBubble m={m} />
                  </React.Fragment>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <Composer conversationId={selectedId} />
    </section>
  );
}

function ChatHeader({ conv }: { conv: ConversationRow }) {
  const title = conversationTitle(conv);
  const initials = conversationInitials(conv);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <AvatarWithStatus initials={initials} size="md" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-bold text-foreground">
              {title}
            </span>
            {conv.patient ? (
              <span className="inline-flex shrink-0 items-center rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                Пациент
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {conv.patient ? (
              <span className="tabular-nums">{conv.patient.phone}</span>
            ) : conv.contactUsername ? (
              <span>@{conv.contactUsername}</span>
            ) : (
              <span>Канал: {conv.channel}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconBtn aria="В избранное">
          <StarIcon className="size-4" />
        </IconBtn>
        <IconBtn aria="Информация">
          <InfoIcon className="size-4" />
        </IconBtn>
        <IconBtn aria="Ещё">
          <MoreHorizontalIcon className="size-4" />
        </IconBtn>
      </div>
    </div>
  );
}

const STATUS_ICON: Record<MessageStatus, React.ReactNode> = {
  QUEUED: <ClockIcon className="size-3" />,
  SENT: <CheckIcon className="size-3" />,
  DELIVERED: (
    <span className="inline-flex items-center text-primary">
      <CheckIcon className="size-3 -mr-1.5" />
      <CheckIcon className="size-3" />
    </span>
  ),
  READ: (
    <span className="inline-flex items-center text-primary">
      <CheckIcon className="size-3 -mr-1.5" />
      <CheckIcon className="size-3" />
    </span>
  ),
  FAILED: <XOctagonIcon className="size-3 text-destructive" />,
};

function MessageBubble({ m }: { m: MessageRow }) {
  const out = m.direction === "OUT";
  const time = new Date(m.createdAt).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className="max-w-[75%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
            out
              ? "rounded-br-md bg-primary/10 text-foreground"
              : "rounded-bl-md bg-muted text-foreground",
          )}
        >
          {m.body ?? "—"}
        </div>
        <div
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums",
            out ? "float-right" : "",
          )}
        >
          {time}
          {out ? STATUS_ICON[m.status] : null}
        </div>
      </div>
    </li>
  );
}

function DaySeparator({ date }: { date: Date }) {
  const today = new Date();
  let label: string;
  const sameYearMonthDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameYearMonthDay(date, today)) {
    label = "Сегодня";
  } else {
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    if (sameYearMonthDay(date, y)) label = "Вчера";
    else
      label = date.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
  }
  return (
    <li className="my-1 flex items-center justify-center">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </li>
  );
}

function Composer({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const { filters } = useMessagesContext();
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/crm/conversations/${conversationId}/messages`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `status ${res.status}`);
      }
      setText("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: conversationMessagesKey(conversationId),
        }),
        queryClient.invalidateQueries({
          queryKey: doctorConversationsKey(filters),
        }),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-border px-5 pb-4 pt-3">
      <div className="flex items-center gap-5 border-b border-border">
        <button
          type="button"
          className="relative inline-flex items-center gap-1.5 pb-2 text-sm font-semibold text-primary"
        >
          <MessageSquareIcon className="size-4" />
          Сообщение
          <span
            aria-hidden
            className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
          />
        </button>
      </div>

      <div className="mt-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Напишите сообщение…  (Enter — отправить, Shift+Enter — новая строка)"
          rows={2}
          className="w-full resize-none rounded-lg bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {error ? (
        <div className="mt-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors",
            !text.trim() || sending
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <SendIcon className="size-4" />
          {sending ? "Отправка…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}

function IconBtn({
  aria,
  children,
}: {
  aria: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
