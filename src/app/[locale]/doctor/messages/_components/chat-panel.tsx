"use client";

import {
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  InfoIcon,
  MessageSquareIcon,
  MicIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  SendIcon,
  SmileIcon,
  StarIcon,
  type LucideIcon,
} from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { cn } from "@/lib/utils";
import {
  MOCK_CHAT_PATIENT,
  MOCK_COMPOSER_TABS,
  MOCK_MESSAGES,
  MOCK_SYSTEM_NOTICE,
  type ChatMessage,
} from "../_mocks";

const COMPOSER_ICON: Record<string, LucideIcon> = {
  message: MessageSquareIcon,
  templates: ClipboardListIcon,
  reminder: BellIcon,
};

export function ChatPanel() {
  const p = MOCK_CHAT_PATIENT;
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <AvatarWithStatus initials={p.initials} size="md" status="online" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-bold text-foreground">
                {p.fullName}
              </span>
              <span className="inline-flex shrink-0 items-center rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                Пациент
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              <span className="tabular-nums">{p.age} лет ({p.birthDate})</span>
              {" • "}
              <span className="tabular-nums">{p.phone}</span>
              {" • ID: "}
              <span className="tabular-nums">{p.id}</span>
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

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <DaySeparator label="Telegram • Сегодня" />

        <div className="mt-4 space-y-3">
          {MOCK_MESSAGES.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
        </div>

        <DaySeparator label="Непрочитанные сообщения" subtle />

        <div className="mt-4">
          <SystemNotice />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border px-5 pb-4 pt-3">
        <div className="flex items-center gap-5 border-b border-border">
          {MOCK_COMPOSER_TABS.map((t, i) => {
            const Icon = COMPOSER_ICON[t.key]!;
            return (
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
                <Icon className="size-4" />
                {t.label}
                {i === 0 ? (
                  <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          <textarea
            placeholder="Напишите сообщение..."
            rows={2}
            className="w-full resize-none rounded-lg bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ComposerAction Icon={PaperclipIcon}>Прикрепить файл</ComposerAction>
            <ComposerAction Icon={MicIcon}>Голосовое сообщение</ComposerAction>
            <IconBtn aria="Эмодзи">
              <SmileIcon className="size-4" />
            </IconBtn>
          </div>
          <div className="inline-flex h-9 overflow-hidden rounded-lg bg-primary">
            <button
              type="button"
              className="motion-press inline-flex items-center gap-2 px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <SendIcon className="size-4" />
              Отправить
            </button>
            <button
              type="button"
              aria-label="Опции отправки"
              className="flex items-center justify-center border-l border-primary-foreground/20 px-2 text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ChevronDownIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const out = m.side === "out";
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className="max-w-[75%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            out
              ? "rounded-br-md bg-primary/10 text-foreground"
              : "rounded-bl-md bg-muted text-foreground",
          )}
        >
          {m.text}
        </div>
        <div
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums",
            out ? "float-right" : "",
          )}
        >
          {m.time}
          {out && m.read ? (
            <span className="inline-flex items-center text-primary">
              <CheckIcon className="size-3 -mr-1.5" />
              <CheckIcon className="size-3" />
            </span>
          ) : null}
        </div>
        {m.emoji ? (
          <div className={cn("clear-both mt-1 text-2xl", out ? "text-right" : "")}>{m.emoji}</div>
        ) : null}
      </div>
    </div>
  );
}

function DaySeparator({ label, subtle }: { label: string; subtle?: boolean }) {
  return (
    <div className="my-1 flex items-center justify-center">
      <span
        className={cn(
          "text-[11px] font-medium uppercase tracking-wide",
          subtle ? "text-muted-foreground/70" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

function SystemNotice() {
  return (
    <div className="rounded-xl border border-border bg-background/60 px-4 py-3">
      <div className="flex items-start gap-2">
        <BellIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            {MOCK_SYSTEM_NOTICE.title}
          </div>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {MOCK_SYSTEM_NOTICE.text}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {MOCK_SYSTEM_NOTICE.time}
        </span>
      </div>
    </div>
  );
}

function ComposerAction({
  Icon,
  children,
}: {
  Icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      <Icon className="size-4 text-muted-foreground" />
      {children}
    </button>
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
