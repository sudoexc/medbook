"use client";

import * as React from "react";
import { MessageSquareIcon, SearchIcon } from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { cn } from "@/lib/utils";

import { useMessagesContext } from "../_hooks/messages-context";
import {
  conversationInitials,
  conversationTitle,
  flattenConversations,
  useDoctorConversations,
  type ConversationChannel,
  type ConversationRow,
} from "../_hooks/use-conversations";

const CHANNEL_CHIPS: Array<{ key: "all" | ConversationChannel; label: string }> = [
  { key: "all", label: "Все" },
  { key: "TG", label: "Telegram" },
  { key: "SMS", label: "SMS" },
];

export function ThreadListSidebar() {
  const { filters, selectedId, setSelectedId, setQ, setChannel, setUnread } =
    useMessagesContext();
  const [rawQ, setRawQ] = React.useState("");
  const query = useDoctorConversations(filters);
  const rows = flattenConversations(query.data);

  // Auto-select first thread once loaded.
  React.useEffect(() => {
    if (!selectedId && rows.length > 0) {
      setSelectedId(rows[0].id);
    }
  }, [selectedId, rows, setSelectedId]);

  const activeChannel: "all" | ConversationChannel = filters.channel ?? "all";

  return (
    <aside className="flex w-[340px] shrink-0 flex-col gap-3">
      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-card">
        <div className="px-5 pt-4">
          <h1 className="text-xl font-bold text-foreground">Сообщения</h1>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUnread(false)}
              className={cn(
                "relative inline-flex items-center gap-1.5 pb-2 text-sm transition-colors",
                !filters.unread
                  ? "font-semibold text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Все
              {!filters.unread ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setUnread(true)}
              className={cn(
                "relative inline-flex items-center gap-1.5 pb-2 text-sm transition-colors",
                filters.unread
                  ? "font-semibold text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Непрочитанные
              {filters.unread ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                />
              ) : null}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {CHANNEL_CHIPS.map((c) => {
              const isSelected = activeChannel === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setChannel(c.key as ConversationChannel | "all")}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-3 text-xs font-medium transition-colors",
                    isSelected
                      ? "bg-primary/10 text-primary"
                      : "border border-border bg-background text-foreground hover:bg-muted",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            <label className="relative block">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={rawQ}
                onChange={(e) => {
                  setRawQ(e.target.value);
                  setQ(e.target.value);
                }}
                placeholder="Поиск по сообщениям..."
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
              />
            </label>
          </div>
        </div>

        <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {query.isLoading ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Загружаем…
            </div>
          ) : query.isError ? (
            <div className="px-3 py-6 text-center text-xs text-destructive">
              Не удалось загрузить
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {filters.q || filters.channel || filters.unread
                ? "Ничего не найдено."
                : "У вас пока нет сообщений."}
            </div>
          ) : (
            <ul>
              {rows.map((t) => (
                <ThreadRow
                  key={t.id}
                  conv={t}
                  selected={t.id === selectedId}
                  onSelect={() => setSelectedId(t.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {query.hasNextPage ? (
          <div className="border-t border-border px-3 py-3">
            <button
              type="button"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="inline-flex w-full items-center justify-center text-sm font-semibold text-primary transition-colors hover:underline disabled:opacity-60"
            >
              {query.isFetchingNextPage ? "Загрузка…" : "Показать ещё"}
            </button>
          </div>
        ) : null}
      </section>
    </aside>
  );
}

const CHANNEL_TONE: Record<ConversationChannel, string> = {
  TG: "bg-primary/10 text-primary",
  SMS: "bg-info/10 text-info",
  CALL: "bg-warning/10 text-warning",
  EMAIL: "bg-muted text-muted-foreground",
  VISIT: "bg-success/10 text-success",
};
const CHANNEL_LABEL: Record<ConversationChannel, string> = {
  TG: "Telegram",
  SMS: "SMS",
  CALL: "Звонок",
  EMAIL: "Email",
  VISIT: "Визит",
};

function ThreadRow({
  conv,
  selected,
  onSelect,
}: {
  conv: ConversationRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const title = conversationTitle(conv);
  const initials = conversationInitials(conv);
  const when = formatRelative(conv.lastMessageAt);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
          selected ? "bg-primary/10" : "hover:bg-muted/50",
        )}
      >
        {conv.channel === "TG" || conv.channel === "SMS" ? (
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              CHANNEL_TONE[conv.channel],
            )}
          >
            <MessageSquareIcon className="size-5" />
          </span>
        ) : (
          <AvatarWithStatus initials={initials} size="md" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "truncate text-sm",
                  selected
                    ? "font-semibold text-foreground"
                    : "font-medium text-foreground",
                )}
              >
                {title}
              </span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                  CHANNEL_TONE[conv.channel],
                )}
              >
                {CHANNEL_LABEL[conv.channel]}
              </span>
            </div>
            {when ? (
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {when}
              </span>
            ) : null}
          </div>

          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {conv.lastMessageText ?? "—"}
            </span>
            {conv.unreadCount > 0 ? (
              <span className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                {conv.unreadCount}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
  );
}

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "сейчас";
  if (diffMin < 60) return `${diffMin} мин`;
  const diffHr = Math.floor(diffMin / 60);
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (diffHr < 48) return "вчера";
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return `${day}.${String(month).padStart(2, "0")}`;
}
