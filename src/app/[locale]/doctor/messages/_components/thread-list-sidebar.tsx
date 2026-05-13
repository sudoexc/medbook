"use client";

import { MessageSquareIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { cn } from "@/lib/utils";
import {
  MOCK_CHANNEL_CHIPS,
  MOCK_TABS,
  MOCK_THREADS,
  type Thread,
} from "../_mocks";

const TELEGRAM_BG = "bg-primary/10 text-primary";
const SMS_BG = "bg-info/10 text-info";
const KIND_CHIP: Record<string, { label: string; cls: string }> = {
  patient: { label: "Пациент", cls: "bg-success/15 text-success" },
  telegram: { label: "Telegram", cls: "bg-primary/10 text-primary" },
  sms: { label: "SMS", cls: "bg-info/10 text-info" },
  internal: { label: "Внутренний", cls: "bg-warning/15 text-warning" },
};

export function ThreadListSidebar() {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col gap-3">
      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-card">
        <div className="px-5 pt-4">
          <h1 className="text-xl font-bold text-foreground">Сообщения</h1>

          {/* Tabs */}
          <div className="mt-3 flex items-center gap-4 border-b border-border">
            {MOCK_TABS.map((t, i) => (
              <button
                key={t.key}
                type="button"
                className={cn(
                  "relative inline-flex items-center gap-1.5 pb-2 text-sm transition-colors",
                  i === 0
                    ? "font-semibold text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {"count" in t && t.count ? (
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {t.count}
                  </span>
                ) : null}
                {i === 0 ? (
                  <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
                ) : null}
              </button>
            ))}
          </div>

          {/* Channels */}
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Каналы
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {MOCK_CHANNEL_CHIPS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={cn(
                  "inline-flex h-7 items-center rounded-full px-3 text-xs font-medium transition-colors",
                  c.selected
                    ? "bg-primary/10 text-primary"
                    : "border border-border bg-background text-foreground hover:bg-muted",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="mt-3 flex items-center gap-2">
            <label className="relative block flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Поиск по сообщениям..."
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15"
              />
            </label>
            <button
              type="button"
              aria-label="Фильтры"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <SlidersHorizontalIcon className="size-4" />
            </button>
          </div>
        </div>

        {/* Thread list */}
        <ul className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {MOCK_THREADS.map((t) => (
            <ThreadRow key={t.id} t={t} />
          ))}
        </ul>

        <div className="border-t border-border px-3 py-3">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center text-sm font-semibold text-primary transition-colors hover:underline"
          >
            Показать ещё
          </button>
        </div>
      </section>
    </aside>
  );
}

function ThreadRow({ t }: { t: Thread }) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
          t.selected ? "bg-primary/10" : "hover:bg-muted/50",
        )}
      >
        {/* Avatar */}
        {t.kind === "telegram" ? (
          <ChannelAvatar bg={TELEGRAM_BG}>
            <TelegramGlyph />
          </ChannelAvatar>
        ) : t.kind === "sms" ? (
          <ChannelAvatar bg={SMS_BG}>
            <MessageSquareIcon className="size-5" />
          </ChannelAvatar>
        ) : (
          <AvatarWithStatus
            initials={t.avatar?.initials ?? "?"}
            size="md"
            status={t.patient ? "online" : undefined}
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "truncate text-sm",
                  t.selected ? "font-semibold text-foreground" : "font-medium text-foreground",
                )}
              >
                {t.title}
              </span>
              {KIND_CHIP[t.kind] ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                    KIND_CHIP[t.kind].cls,
                  )}
                >
                  {KIND_CHIP[t.kind].label}
                </span>
              ) : null}
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {t.when}
            </span>
          </div>

          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">{t.preview}</span>
            {t.unread ? (
              <span className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                {t.unread}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
  );
}

function ChannelAvatar({
  bg,
  children,
}: {
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full",
        bg,
      )}
    >
      {children}
    </span>
  );
}

function TelegramGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
      <path d="M21.94 3.17a1 1 0 0 0-1.04-.15L2.84 10.41a1 1 0 0 0 .03 1.86l4.27 1.5 2.07 5.74a1 1 0 0 0 1.63.37l2.69-2.51 4.47 3.28a1 1 0 0 0 1.57-.6L22 4.2a1 1 0 0 0-.06-1.03Zm-3.7 3.36-7.83 6.78-.3 2.78-1.43-4 9.56-5.56Z" />
    </svg>
  );
}

