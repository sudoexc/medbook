"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLinkIcon, MessageSquareIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";

import type { ConversationRow } from "../_hooks/use-reception-live";

export interface TgPreviewWidgetProps {
  rows: ConversationRow[];
  isLoading: boolean;
  className?: string;
}

/**
 * Right-rail "Telegram / SMS" preview per TZ §6.1.4(B).
 *
 * Picks the 5 most recent unread conversations. Clicking a row routes to the
 * conversation thread in `/crm/telegram` (dedicated page lives in Phase 3b).
 */
export function TgPreviewWidget({
  rows,
  isLoading,
  className,
}: TgPreviewWidgetProps) {
  const t = useTranslations("reception.tg");

  const unreadTotal = rows.reduce((acc, r) => acc + (r.unreadCount ?? 0), 0);
  const visible = rows.slice(0, 5);

  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquareIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
          {unreadTotal > 0 ? (
            <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {t("unread", { count: unreadTotal })}
            </span>
          ) : null}
        </div>
        <Link
          href="/crm/telegram"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
          )}
          aria-label={t("openFull")}
          title={t("openFull")}
        >
          <ExternalLinkIcon className="size-3.5" />
        </Link>
      </header>

      <div className="p-3">
        {isLoading ? (
          <ul className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="h-12 animate-pulse rounded-md bg-muted"
                aria-hidden
              />
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border bg-card/40 px-3 py-6 text-center">
            <MessageSquareIcon
              className="size-5 text-muted-foreground"
              aria-hidden
            />
            <p className="text-sm font-medium text-foreground">{t("empty")}</p>
            <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {visible.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/crm/telegram?c=${row.id}`}
                  className="-mx-1 flex items-start gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-muted"
                >
                  <AvatarWithStatus
                    name={row.patient?.fullName ?? "?"}
                    src={row.patient?.photoUrl ?? null}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {row.patient?.fullName ?? row.patient?.phone ?? t("title")}
                      </span>
                      {row.unreadCount > 0 ? (
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                          {row.unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.lastMessageText ?? t("voiceNote")}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
