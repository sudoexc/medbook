"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SearchIcon } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { DateText } from "@/components/atoms/date-text";
import { SkeletonRow } from "@/components/atoms/skeleton-row";

import type {
  ConversationFilters,
} from "../_hooks/use-conversations";
import type { InboxConversation, ModeFilter } from "../_hooks/types";

export interface ConversationListProps {
  rows: InboxConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filters: ConversationFilters;
  setFilters: (patch: Partial<ConversationFilters>) => void;
  isLoading: boolean;
  hasNextPage: boolean;
  onFetchNext: () => void;
}

const MODE_OPTIONS: ModeFilter[] = ["all", "bot", "takeover"];

export function ConversationList({
  rows,
  selectedId,
  onSelect,
  filters,
  setFilters,
  isLoading,
  hasNextPage,
  onFetchNext,
}: ConversationListProps) {
  const t = useTranslations("tgInbox");
  const [search, setSearch] = React.useState(filters.q);

  // Debounce the q filter → URL-sync.
  React.useEffect(() => {
    const id = setTimeout(() => {
      if (search !== filters.q) setFilters({ q: search });
    }, 250);
    return () => clearTimeout(id);
  }, [search, filters.q, setFilters]);

  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    overscan: 6,
  });

  // Auto-load next page when scrolling near bottom.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      if (!hasNextPage) return;
      const bottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (bottom < 200) onFetchNext();
    };
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }, [hasNextPage, onFetchNext]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: search + filter chips */}
      <div className="space-y-3 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("list.searchPlaceholder")}
              className="pl-8"
              aria-label={t("list.searchAria")}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setFilters({ mode: m })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                filters.mode === m
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`list.mode.${m}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <Switch
              checked={filters.unreadOnly}
              onCheckedChange={(v) => setFilters({ unreadOnly: v })}
              aria-label={t("list.unreadToggle")}
            />
            {t("list.unreadToggle")}
          </label>
          <span>{t("list.count", { n: rows.length })}</span>
        </div>
      </div>

      {/* List */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        role="list"
        aria-live="polite"
        aria-atomic="false"
        aria-label={t("list.ariaLabel")}
      >
        {isLoading && rows.length === 0 ? (
          <div className="space-y-0 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {t("list.empty")}
          </div>
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index]!;
              return (
                <div
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vi.start}px)`,
                    height: vi.size,
                  }}
                >
                  <ConversationRow
                    row={row}
                    active={row.id === selectedId}
                    onSelect={onSelect}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationRow({
  row,
  active,
  onSelect,
}: {
  row: InboxConversation;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("tgInbox");
  const previewText = row.lastMessageText ?? "";
  const name = row.patient?.fullName ?? row.externalId ?? t("list.anonymous");
  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border px-3 py-2.5 text-left transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/40",
      )}
    >
      <AvatarWithStatus
        name={name}
        src={row.patient?.photoUrl ?? null}
        status={row.unreadCount > 0 ? "online" : null}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-sm font-medium text-foreground">
            {name}
          </div>
          {row.lastMessageAt ? (
            <DateText
              date={row.lastMessageAt}
              style="relative"
              className="shrink-0 text-xs text-muted-foreground"
            />
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          {row.mode === "takeover" ? (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {t("list.mode.takeoverBadge")}
            </Badge>
          ) : null}
          <div className="truncate text-xs text-muted-foreground">
            {previewText || t("list.noMessages")}
          </div>
        </div>
      </div>
      {row.unreadCount > 0 ? (
        <Badge variant="default" className="ml-auto shrink-0 bg-primary text-primary-foreground">
          {row.unreadCount}
        </Badge>
      ) : null}
    </button>
  );
}
