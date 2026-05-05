"use client";

import * as React from "react";
import { Bell, Check, X } from "lucide-react";

import { useInbox, useMarkInboxItemRead } from "../_hooks/use-inbox";
import { useT } from "./mini-i18n";

/**
 * Top-of-home banner showing unread INAPP notifications.
 *
 * One row per unread item — REMINDER category gets a calendar bell icon,
 * tapping the body deep-links to the appointment / case if applicable.
 * "Прочитано" / "Yopish" mark the row as read (server flips status to
 * READ + readAt). The banner self-hides when the unread queue is empty.
 *
 * Render contract: drop-in above the existing home content. Loading state
 * is silent (no skeleton) so the banner doesn't flash on first paint.
 */
export function InboxBanner() {
  const t = useT();
  const inbox = useInbox();
  const markRead = useMarkInboxItemRead();

  const items = inbox.data?.items ?? [];
  const unread = items.filter((i) => i.readAt === null);
  if (unread.length === 0) return null;

  return (
    <div className="ma-fade-up mb-4 space-y-2" style={{ animationDelay: "0ms" }}>
      <div
        className="text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--tg-hint)" }}
      >
        {t.inbox.header}
      </div>
      {unread.slice(0, 3).map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-3 rounded-2xl p-3"
          style={{
            backgroundColor: "var(--tg-section-bg)",
            color: "var(--tg-text)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <span
            className="mt-0.5 shrink-0"
            style={{ color: "var(--tg-accent)" }}
          >
            <Bell className="h-5 w-5" />
          </span>
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
  );
}
