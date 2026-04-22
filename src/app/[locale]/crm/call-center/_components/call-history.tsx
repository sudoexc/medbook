"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { HistoryIcon, PlayIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

import type { CallRow } from "../_hooks/types";
import { deriveStatus } from "../_hooks/types";
import { CallBubble } from "./call-bubble";
import { CallHistoryFilters } from "./call-history-filters";
import type { HistoryFilters } from "../_hooks/use-call-history";

/**
 * Right column — recent history.
 *
 * Shows every call (unlike the left column which narrows to ringing). Rows
 * are filtered server-side (direction, operator, date range, search) and
 * post-filtered client-side for the derived `status` chip. Each row exposes
 * a play button when `recordingUrl` is set.
 *
 * Uses CSS overflow + IntersectionObserver for infinite scroll rather than a
 * heavy virtualizer library; call history rarely exceeds a few hundred
 * visible rows and this keeps the component tree small.
 */
export function CallHistory({
  rows,
  filters,
  setFilters,
  onReset,
  onSelect,
  selectedId,
  isLoading,
  hasNextPage,
  onFetchNext,
}: {
  rows: CallRow[];
  filters: HistoryFilters;
  setFilters: (patch: Partial<HistoryFilters>) => void;
  onReset: () => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  isLoading: boolean;
  hasNextPage: boolean;
  onFetchNext: () => void;
}) {
  const t = useTranslations("callCenter.history");

  const sentinelRef = React.useRef<HTMLLIElement | null>(null);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onFetchNext();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, onFetchNext, rows.length]);

  const filtered = React.useMemo(() => {
    if (filters.status === "all") return rows;
    return rows.filter((row) => deriveStatus(row) === filters.status);
  }, [rows, filters.status]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">{t("title")}</h2>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {filtered.length}
        </span>
      </header>

      <CallHistoryFilters
        filters={filters}
        setFilters={setFilters}
        onReset={onReset}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading && filtered.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">{t("loading")}</p>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-8 text-center">
            <HistoryIcon className="size-8 text-muted-foreground/40" aria-hidden />
            <p className="text-xs text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          <ul className="grid gap-1">
            {filtered.map((row) => (
              <li key={row.id} className="relative">
                <CallBubble
                  row={row}
                  onClick={() => onSelect(row.id)}
                  selected={row.id === selectedId}
                  dense
                />
                {row.recordingUrl ? (
                  <a
                    href={row.recordingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon-sm" }),
                      "absolute right-2 top-1/2 -translate-y-1/2",
                    )}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t("play")}
                  >
                    <PlayIcon className="size-4" />
                  </a>
                ) : null}
              </li>
            ))}
            {hasNextPage ? (
              <li ref={sentinelRef} className="h-8">
                <span className="block py-2 text-center text-[11px] text-muted-foreground">
                  {t("loadingMore")}
                </span>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <footer className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        {t("pollingHint")}
      </footer>
    </div>
  );
}
