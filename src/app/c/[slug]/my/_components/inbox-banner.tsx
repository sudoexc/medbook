"use client";

import * as React from "react";
import { Bell, Check, ChevronDown, X } from "lucide-react";

import { useInbox, useMarkInboxItemRead } from "../_hooks/use-inbox";
import { useT } from "./mini-i18n";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

/**
 * Unread INAPP notifications, Payme-style: collapsed by default into one
 * slim row (bell + count badge + latest message on a single line) so the
 * home screen stays hero-first. Tapping expands the full unread list with
 * per-item mark-read. Self-hides when the unread queue is empty.
 *
 * Loading state is silent (no skeleton) so the row doesn't flash on first
 * paint.
 */

const MAX_EXPANDED = 3;

export function InboxBanner() {
  const t = useT();
  const tg = useTelegramWebApp();
  const inbox = useInbox();
  const markRead = useMarkInboxItemRead();
  const [open, setOpen] = React.useState(false);

  const items = inbox.data?.items ?? [];
  const unread = items.filter((i) => i.readAt === null);
  if (unread.length === 0) return null;

  const latest = unread[0];
  const preview = latest.body.replace(/\s+/g, " ").trim();

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => {
          tg.haptic.selection();
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition active:scale-[0.99]"
        style={{
          backgroundColor: "var(--tg-section-bg)",
          color: "var(--tg-text)",
          border:
            "1px solid color-mix(in oklch, var(--tg-hint) 14%, transparent)",
        }}
        aria-expanded={open}
      >
        <span className="relative shrink-0" style={{ color: "var(--tg-accent)" }}>
          <Bell className="h-4 w-4" />
          <span
            className="absolute -right-1.5 -top-1.5 grid h-3.5 min-w-[0.875rem] place-items-center rounded-full px-0.5 text-[9px] font-bold leading-none text-white"
            style={{ backgroundColor: "var(--tg-accent)" }}
          >
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{preview}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          style={{ color: "var(--tg-hint)" }}
        />
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {unread.slice(0, MAX_EXPANDED).map((item) => (
            <div
              key={item.id}
              className="ma-fade-up flex items-start gap-3 rounded-2xl p-3"
              style={{
                backgroundColor: "var(--tg-section-bg)",
                color: "var(--tg-text)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <p className="min-w-0 flex-1 whitespace-pre-line text-sm leading-snug">
                {item.body}
              </p>
              <button
                type="button"
                onClick={() => markRead.mutate(item.id)}
                disabled={markRead.isPending}
                className="shrink-0 rounded-full p-1 transition active:scale-95"
                style={{ color: "var(--tg-hint)" }}
                aria-label={t.inbox.markRead}
              >
                {markRead.isPending && markRead.variables === item.id ? (
                  <Check className="h-4 w-4 opacity-50" />
                ) : (
                  <X className="h-4 w-4" />
                )}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
