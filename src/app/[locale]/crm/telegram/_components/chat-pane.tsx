"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Loader2Icon,
  UserIcon,
  UserRoundIcon,
  PhoneIcon,
  MoreVerticalIcon,
  PanelRightIcon,
  ChevronDownIcon,
  CheckIcon,
  BanIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/atoms/empty-state";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { PhoneText } from "@/components/atoms/phone-text";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { InboxConversation, InboxMessage } from "../_hooks/types";
import {
  flattenMessages,
  useTgMessages,
  useTgMessagesRealtime,
} from "../_hooks/use-tg-messages";
import { useMarkConversationRead } from "../_hooks/use-mark-read";
import { useChatFind } from "../_hooks/use-tg-events";
import {
  useAssignees,
  useUpdateConversationMeta,
} from "../_hooks/use-conversation-meta";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { ModeSwitch } from "./mode-switch";

export interface ChatPaneProps {
  conversation: InboxConversation | null;
  railOpen?: boolean;
  onToggleRail?: () => void;
}

const GROUP_GAP_MS = 5 * 60_000;

function startOfDay(iso: string): number {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Same visual author = same direction and same operator/bot sender. */
function sameAuthor(a: InboxMessage, b: InboxMessage): boolean {
  return a.direction === b.direction && (a.senderId ?? null) === (b.senderId ?? null);
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="sticky top-1 z-[1] my-2.5 flex justify-center">
      <span className="rounded-full bg-card/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm ring-1 ring-border/50 backdrop-blur">
        {label}
      </span>
    </div>
  );
}

export function ChatPane({ conversation, railOpen, onToggleRail }: ChatPaneProps) {
  const t = useTranslations("tgInbox");
  const locale = useLocale();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const dayFmt = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
        day: "numeric",
        month: "long",
      }),
    [locale],
  );
  const dayLabel = React.useCallback(
    (iso: string): string => {
      const today = startOfDay(new Date().toISOString());
      const diff = Math.round((today - startOfDay(iso)) / 86_400_000);
      if (diff === 0) return t("chat.today");
      if (diff === 1) return t("chat.yesterday");
      return dayFmt.format(new Date(iso));
    },
    [t, dayFmt],
  );
  const messagesQuery = useTgMessages(conversation?.id ?? null);
  const messages = flattenMessages(messagesQuery.data?.pages);
  const markRead = useMarkConversationRead();
  const [showScrollDown, setShowScrollDown] = React.useState(false);

  const conversationId = conversation?.id ?? null;
  // Live-update the open thread: invalidate the messages query whenever a
  // `tg.message.new` for this conversation lands on the SSE bus. Without this
  // the thread only refreshes on the 60s poll (the list updates separately via
  // useTgInboxAlerts, which is why the unread badge moved but the thread lagged).
  useTgMessagesRealtime(conversationId);
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

  // Toggle the scroll-to-bottom FAB when the user has scrolled up far enough
  // that newer messages are off-screen. Guarded with functional setState so the
  // listener never fires a no-op render on every scroll tick.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const far = el.scrollHeight - el.scrollTop - el.clientHeight > 240;
      setShowScrollDown((v) => (v === far ? v : far));
    };
    onScroll();
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [conversationId]);

  const scrollToBottom = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

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

  const callablePhone = conversation.patient?.phone
    ? conversation.patient.phone.replace(/\s/g, "")
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-border/60 bg-card/80 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/70">
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
            size="lg"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-semibold leading-tight">
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
              {conversation.patient?.tgBlockedAt ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive">
                  <BanIcon className="size-3" aria-hidden />
                  {t("chat.blockedBadge")}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
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
          <AssigneeSelect conversation={conversation} />
          <ModeSwitch conversationId={conversation.id} mode={conversation.mode} />
          {callablePhone ? (
            <a
              href={`tel:${callablePhone}`}
              className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-[var(--motion-dur-fast)] ease-out hover:bg-muted hover:text-foreground motion-safe:hover:-translate-y-px active:translate-y-0 active:scale-95"
              aria-label={t("chat.call")}
            >
              <PhoneIcon className="size-4" />
            </a>
          ) : null}
          {onToggleRail ? (
            <button
              type="button"
              onClick={onToggleRail}
              aria-pressed={railOpen}
              aria-label={railOpen ? t("chat.hideInfo") : t("chat.showInfo")}
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-full transition-[transform,background-color,color] duration-[var(--motion-dur-fast)] ease-out hover:bg-muted hover:text-foreground motion-safe:hover:-translate-y-px active:translate-y-0 active:scale-95",
                railOpen ? "text-primary" : "text-muted-foreground",
              )}
            >
              <PanelRightIcon className="size-4" />
            </button>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-[var(--motion-dur-fast)] ease-out hover:bg-muted hover:text-foreground motion-safe:hover:-translate-y-px active:translate-y-0 active:scale-95"
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
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-muted/10 px-4 py-3"
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
            {messages.map((m, i) => {
              const prev = i > 0 ? messages[i - 1]! : null;
              const next = i < messages.length - 1 ? messages[i + 1]! : null;
              const tCur = new Date(m.createdAt).getTime();
              const showDay = !prev || startOfDay(prev.createdAt) !== startOfDay(m.createdAt);
              const groupStart =
                showDay ||
                !prev ||
                !sameAuthor(prev, m) ||
                tCur - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
              const groupEnd =
                !next ||
                startOfDay(next.createdAt) !== startOfDay(m.createdAt) ||
                !sameAuthor(m, next) ||
                new Date(next.createdAt).getTime() - tCur > GROUP_GAP_MS;
              return (
                <React.Fragment key={m.id}>
                  {showDay ? <DayDivider label={dayLabel(m.createdAt)} /> : null}
                  <MessageBubble
                    message={m}
                    groupStart={groupStart}
                    groupEnd={groupEnd}
                  />
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>
        {showScrollDown ? (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label={t("chat.scrollToBottom")}
            className="absolute bottom-4 right-4 inline-flex size-10 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground shadow-md transition-[transform,background-color,color] duration-[var(--motion-dur-fast)] ease-out hover:bg-muted hover:text-foreground motion-safe:hover:-translate-y-px active:translate-y-0 active:scale-95 motion-safe:animate-[motion-zoom-in_var(--motion-dur-fast)_var(--motion-ease-out)]"
          >
            <ChevronDownIcon className="size-5" />
          </button>
        ) : null}
      </div>

      {/* Composer */}
      <MessageComposer conversation={conversation} />
    </div>
  );
}

function AssigneeSelect({ conversation }: { conversation: InboxConversation }) {
  const t = useTranslations("tgInbox.assignee");
  const [open, setOpen] = React.useState(false);
  const assigneesQuery = useAssignees(open);
  const update = useUpdateConversationMeta(conversation.id);
  const current = conversation.assignedTo;

  const assign = async (id: string | null) => {
    if ((current?.id ?? null) === id) {
      setOpen(false);
      return;
    }
    setOpen(false);
    try {
      await update.mutateAsync({ assignedToId: id });
      toast.success(id ? t("assigned") : t("unassigned"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("label")}
          title={t("label")}
          className={cn(
            "inline-flex h-9 max-w-[160px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
            current
              ? "border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {update.isPending ? (
            <Loader2Icon className="size-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <UserRoundIcon className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className="truncate">{current?.name ?? t("unassignedShort")}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </div>
        <button
          type="button"
          onClick={() => assign(null)}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
            !current && "bg-primary/10",
          )}
        >
          <span className="text-muted-foreground">{t("unassign")}</span>
          {!current ? <CheckIcon className="size-3.5 text-primary" /> : null}
        </button>
        {assigneesQuery.isLoading ? (
          <div className="p-3 text-center">
            <Loader2Icon className="mx-auto size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          (assigneesQuery.data?.rows ?? []).map((op) => (
            <button
              key={op.id}
              type="button"
              onClick={() => assign(op.id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
                current?.id === op.id && "bg-primary/10",
              )}
            >
              <span className="truncate">{op.name}</span>
              {current?.id === op.id ? (
                <CheckIcon className="size-3.5 shrink-0 text-primary" />
              ) : null}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
