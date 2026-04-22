"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2Icon, UserIcon, BotIcon, HeadsetIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/atoms/empty-state";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { PhoneText } from "@/components/atoms/phone-text";

import type { InboxConversation } from "../_hooks/types";
import {
  flattenMessages,
  useTgMessages,
} from "../_hooks/use-tg-messages";
import { useTakeover } from "../_hooks/use-takeover";
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
            name={conversation.patient?.fullName ?? conversation.externalId ?? ""}
            src={conversation.patient?.photoUrl ?? null}
            size="md"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {conversation.patient?.fullName ?? t("list.anonymous")}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {conversation.patient?.phone ? (
                <PhoneText phone={conversation.patient.phone} />
              ) : conversation.externalId ? (
                `chat_id ${conversation.externalId}`
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={isTakeover ? "default" : "secondary"}
            className={cn(isTakeover ? "bg-orange-500 text-white" : "")}
          >
            {isTakeover ? (
              <span className="flex items-center gap-1">
                <HeadsetIcon className="size-3" />
                {t("chat.mode.takeover")}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <BotIcon className="size-3" />
                {t("chat.mode.bot")}
              </span>
            )}
          </Badge>
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
