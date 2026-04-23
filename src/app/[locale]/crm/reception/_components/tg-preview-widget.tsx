"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";

import type { ConversationRow } from "../_hooks/use-reception-live";

export interface TgPreviewWidgetProps {
  rows: ConversationRow[];
  isLoading: boolean;
  className?: string;
}

type TabKey = "new" | "waiting" | "confirmed" | "all";
const TABS: { key: TabKey; label: string }[] = [
  { key: "new", label: "Новые" },
  { key: "waiting", label: "Ожидают" },
  { key: "confirmed", label: "Подтв." },
  { key: "all", label: "Все" },
];

/**
 * "TELEGRAM" preview per docs/1-Ресепшн mockup.
 *
 *   Header + tab strip + vertical conversation list + footer link.
 */
export function TgPreviewWidget({
  rows,
  isLoading,
  className,
}: TgPreviewWidgetProps) {
  const [tab, setTab] = React.useState<TabKey>("new");

  const unreadTotal = rows.reduce((acc, r) => acc + (r.unreadCount ?? 0), 0);
  const counts = React.useMemo(() => {
    const c: Record<TabKey, number> = {
      new: 0,
      waiting: 0,
      confirmed: 0,
      all: rows.length,
    };
    for (const r of rows) {
      if (r.unreadCount > 0) c.new += 1;
      if (r.status === "SNOOZED") c.waiting += 1;
      if (r.status === "CLOSED") c.confirmed += 1;
    }
    return c;
  }, [rows]);

  const filtered = React.useMemo(() => {
    if (tab === "new") return rows.filter((r) => r.unreadCount > 0);
    if (tab === "waiting") return rows.filter((r) => r.status === "SNOOZED");
    if (tab === "confirmed") return rows.filter((r) => r.status === "CLOSED");
    return rows;
  }, [rows, tab]);

  const visible = filtered.slice(0, 5);

  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Telegram
          </h3>
          {unreadTotal > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-info px-1.5 text-[10px] font-bold text-info-foreground">
              {unreadTotal}
            </span>
          ) : null}
        </div>
        <Link
          href="/crm/telegram"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          Все
          <ChevronRightIcon className="size-3" />
        </Link>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label}
              {count > 0 ? (
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <ul className="flex flex-col gap-1 p-3">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="h-12 animate-pulse rounded-md bg-muted"
                aria-hidden
              />
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Сообщений нет
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((row) => (
              <ConversationRowItem key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ConversationRowItem({ row }: { row: ConversationRow }) {
  const time = row.lastMessageAt
    ? new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(row.lastMessageAt))
    : "";
  return (
    <li>
      <Link
        href={`/crm/telegram?c=${row.id}`}
        className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/60"
      >
        <AvatarWithStatus
          name={row.patient?.fullName ?? "?"}
          src={row.patient?.photoUrl ?? null}
          size="sm"
          status={row.unreadCount > 0 ? "online" : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {row.patient?.fullName ?? row.patient?.phone ?? "Неизвестный"}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {time}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">
              {row.lastMessageText ?? "Голосовое сообщение"}
            </p>
            {row.unreadCount > 0 ? (
              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-info px-1 text-[10px] font-bold text-info-foreground tabular-nums">
                {row.unreadCount}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}
