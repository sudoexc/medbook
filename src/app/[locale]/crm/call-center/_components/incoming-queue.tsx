"use client";

import { useTranslations } from "next-intl";
import { PhoneIncomingIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";

import type { CallRow } from "../_hooks/types";
import { CallBubble } from "./call-bubble";
import { CallsErrorState } from "./calls-error-state";

/**
 * Left column — ringing queue.
 *
 * Shows every call that is still in-flight (direction=IN, endedAt=null).
 * The toast for a new call is raised by `useIncomingCallAlerts` in the page
 * client (audit CM-27): this column unmounts on the «Пропущенные» tab.
 *
 * Selection is URL-synced via `use-active-call.ts` — the page client owns the
 * `selectedId` + `onSelect` plumbing.
 */
export function IncomingQueue({
  rows,
  selectedId,
  onSelect,
  isLoading,
  isFetching,
  error,
  showHeader = true,
}: {
  rows: CallRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading?: boolean;
  isFetching?: boolean;
  /** A failed load is shown as such, never as «Сейчас тихо» (audit CM-08). */
  error?: Error | null;
  /** The page's tab bar already names the list and its count. */
  showHeader?: boolean;
}) {
  const t = useTranslations("callCenter.queue");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showHeader ? (
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <PhoneIncomingIcon className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">{t("title")}</h2>
            {isFetching && !isLoading ? (
              <span
                className="size-1.5 animate-pulse rounded-full bg-primary"
                aria-label={t("polling")}
              />
            ) : null}
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {rows.length}
          </span>
        </header>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && rows.length === 0 ? (
          <CallsErrorState error={error} />
        ) : isLoading && rows.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">{t("loading")}</p>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 py-6">
            <EmptyState
              icon={<PhoneIncomingIcon />}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
              className="border-none bg-transparent px-2 py-4"
            />
          </div>
        ) : (
          <ul className="grid gap-1">
            {rows.map((row) => (
              <li key={row.id}>
                <CallBubble
                  row={row}
                  onClick={() => onSelect(row.id)}
                  selected={row.id === selectedId}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        {/* SSE-driven via useCallCenterRealtime; the 60s poll is the
            resilience fallback, and the hint says exactly that (CM-27). */}
        {t("pollingHint")}
      </footer>
    </div>
  );
}
