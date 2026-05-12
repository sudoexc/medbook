"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Loader2Icon,
  UserIcon,
  BotIcon,
  HeadsetIcon,
  MoreVerticalIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { PhoneText } from "@/components/atoms/phone-text";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { InboxConversation } from "../_hooks/types";
import {
  flattenMessages,
  useTgMessages,
} from "../_hooks/use-tg-messages";
import { useTakeover } from "../_hooks/use-takeover";
import { useMarkConversationRead } from "../_hooks/use-mark-read";
import { useChatFind } from "../_hooks/use-tg-events";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";

export interface ChatPaneProps {
  conversation: InboxConversation | null;
}

export function ChatPane({ conversation }: ChatPaneProps) {
  const t = useTranslations("tgInbox");
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const messagesQuery = useTgMessages(conversation?.id ?? null);
  const messages = flattenMessages(messagesQuery.data?.pages);
  const takeover = useTakeover();
  const markRead = useMarkConversationRead();

  const conversationId = conversation?.id ?? null;
  const unread = conversation?.unreadCount ?? 0;
  const lastMarkedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!conversationId || unread <= 0) return;
    if (lastMarkedRef.current === conversationId) return;
    lastMarkedRef.current = conversationId;
    markRead.mutate(conversationId);
  }, [conversationId, unread, markRead]);

  // Stick-to-bottom on new messages; preserve scroll when loading older.
  const messageCountRef = React.useRef(messages.length);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = messageCountRef.current;
    messageCountRef.current = messages.length;
    // If we only gained newer messages and user was near bottom, scroll down.
    if (messages.length > prev) {
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (nearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages.length]);

  // External "find by keyword" — fired from right rail topic chips. Scrolls
  // the first matching message into view and briefly pulses it so the user
  // can see what was matched.
  useChatFind(conversationId, ({ term }) => {
    const el = scrollRef.current;
    if (!el) return;
    const root = el.getRootNode() as Document | ShadowRoot;
    const escaped = term.replace(/"/g, '\\"').toLowerCase();
    const bubbles = el.querySelectorAll<HTMLElement>("[data-message-id]");
    let hit: HTMLElement | null = null;
    for (const node of Array.from(bubbles)) {
      const body = (node.getAttribute("data-message-body") ?? "").toLowerCase();
      if (body.includes(escaped)) {
        hit = node;
        break;
      }
    }
    if (!hit) return;
    hit.scrollIntoView({ behavior: "smooth", block: "center" });
    hit.classList.remove("tg-find-pulse");
    void (hit as HTMLElement).offsetWidth; // restart animation
    hit.classList.add("tg-find-pulse");
    void root;
  });

  // Auto-load older when scrolling near top.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      if (!messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage) return;
      if (el.scrollTop < 100) {
        const prevHeight = el.scrollHeight;
        void messagesQuery.fetchNextPage().then(() => {
          requestAnimationFrame(() => {
            const next = el.scrollHeight;
            el.scrollTop = next - prevHeight;
          });
        });
      }
    };
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }, [messagesQuery]);

  if (!conversation) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <EmptyState
          icon={<UserIcon />}
          title={t("chat.empty.title")}
          description={t("chat.empty.description")}
        />
      </div>
    );
  }

  const isTakeover = conversation.mode === "takeover";
  const toggleMode = () => {
    takeover.mutate({
      conversationId: conversation.id,
      mode: isTakeover ? "bot" : "takeover",
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <AvatarWithStatus
            name={
              conversation.patient?.fullName ??
              [conversation.contactFirstName, conversation.contactLastName]
                .filter(Boolean)
                .join(" ") ??
              conversation.externalId ??
              ""
            }
            src={conversation.patient?.photoUrl ?? null}
            size="md"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold">
                {conversation.patient?.fullName ??
                  [conversation.contactFirstName, conversation.contactLastName]
                    .filter(Boolean)
                    .join(" ")
                    .trim() ??
                  (conversation.contactUsername
                    ? `@${conversation.contactUsername}`
                    : null) ??
                  t("list.anonymous")}
              </span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  isTakeover
                    ? "bg-warning/15 text-[color:var(--warning)]"
                    : "bg-primary/10 text-primary",
                )}
              >
                {isTakeover ? (
                  <HeadsetIcon className="size-2.5" aria-hidden />
                ) : (
                  <BotIcon className="size-2.5" aria-hidden />
                )}
                {isTakeover ? t("chat.mode.takeover") : t("chat.mode.bot")}
              </span>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {conversation.patient?.phone ? (
                <PhoneText phone={conversation.patient.phone} />
              ) : conversation.contactUsername ? (
                <>@{conversation.contactUsername}{conversation.externalId ? ` · id ${conversation.externalId}` : null}</>
              ) : conversation.externalId ? (
                `id ${conversation.externalId}`
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={isTakeover ? "outline" : "default"}
            size="sm"
            onClick={toggleMode}
            disabled={takeover.isPending}
          >
            {takeover.isPending ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : null}
            {isTakeover ? t("chat.returnToBot") : t("chat.takeover")}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t("chat.moreMenu")}
              >
                <MoreVerticalIcon className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <button
                type="button"
                onClick={() => markRead.mutate(conversation.id)}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                {t("chat.markRead")}
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/10 p-4"
      >
        {messagesQuery.isLoading ? (
          <div className="flex justify-center py-4 text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t("chat.noMessages")}
          </div>
        ) : (
          <>
            {messagesQuery.isFetchingNextPage ? (
              <div className="flex justify-center py-2 text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
              </div>
            ) : null}
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </>
        )}
      </div>

      {/* Composer */}
      <MessageComposer conversation={conversation} />
    </div>
  );
}
