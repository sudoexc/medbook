"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SearchIcon } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { DateText } from "@/components/atoms/date-text";
import { SkeletonRow } from "@/components/atoms/skeleton-row";

import type {
  ConversationFilters,
  AssigneeFilter,
} from "../_hooks/use-conversations";
import type { InboxConversation } from "../_hooks/types";

const ASSIGNEE_FILTERS: AssigneeFilter[] = ["all", "mine"];

export interface ConversationListProps {
  rows: InboxConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filters: ConversationFilters;
  setFilters: (patch: Partial<ConversationFilters>) => void;
  isLoading: boolean;
  hasNextPage: boolean;
  onFetchNext: () => void;
  /** Conversation ids that just received a realtime event — pulse the row. */
  pulsedIds?: ReadonlySet<string>;
}

type InboxTab = "all" | "unanswered" | "active";
const TABS: InboxTab[] = ["all", "unanswered", "active"];

type Temperature = "hot" | "warm" | "cold";
type TempFilter = "all" | Temperature;
const TEMP_FILTERS: TempFilter[] = ["all", "hot", "warm", "cold"];

const HOT_MAX_MIN = 120; // unread + last activity within 2h → needs reply now
const WARM_MAX_MIN = 24 * 60; // activity within a day → still warm

/** Lead-urgency heuristic from unread + recency (client-side triage). */
function temperatureOf(row: InboxConversation, now: number): Temperature {
  const last = row.lastMessageAt ? new Date(row.lastMessageAt).getTime() : 0;
  const ageMin = last ? (now - last) / 60_000 : Number.POSITIVE_INFINITY;
  if (row.unreadCount > 0 && ageMin <= HOT_MAX_MIN) return "hot";
  if (row.unreadCount > 0 || ageMin <= WARM_MAX_MIN) return "warm";
  return "cold";
}

const TEMP_DOT: Record<TempFilter, string> = {
  all: "bg-muted-foreground/50",
  hot: "bg-destructive",
  warm: "bg-[color:var(--warning)]",
  cold: "bg-[color:var(--info)]",
};

function tabFromFilters(f: ConversationFilters): InboxTab {
  if (f.unreadOnly) return "unanswered";
  if (f.mode === "takeover") return "active";
  return "all";
}

export function ConversationList({
  rows,
  selectedId,
  onSelect,
  filters,
  setFilters,
  isLoading,
  hasNextPage,
  onFetchNext,
  pulsedIds,
}: ConversationListProps) {
  const t = useTranslations("tgInbox");
  const [search, setSearch] = React.useState(filters.q);
  const [temp, setTemp] = React.useState<TempFilter>("all");

  // Debounce the q filter → URL-sync.
  React.useEffect(() => {
    const id = setTimeout(() => {
      if (search !== filters.q) setFilters({ q: search });
    }, 250);
    return () => clearTimeout(id);
  }, [search, filters.q, setFilters]);

  const activeTab = tabFromFilters(filters);

  // Temperature is a client-side triage filter over the rows the server
  // already returned for the active tab. Counts reflect what's loaded.
  const { displayRows, tempCounts } = React.useMemo(() => {
    const now = Date.now();
    const counts: Record<Temperature, number> = { hot: 0, warm: 0, cold: 0 };
    const filtered: InboxConversation[] = [];
    for (const r of rows) {
      const tmp = temperatureOf(r, now);
      counts[tmp] += 1;
      if (temp === "all" || tmp === temp) filtered.push(r);
    }
    return { displayRows: filtered, tempCounts: counts };
  }, [rows, temp]);

  const tempCountFor = (f: TempFilter): number =>
    f === "all" ? rows.length : tempCounts[f];

  const setTab = (tab: InboxTab) => {
    if (tab === "unanswered") setFilters({ unreadOnly: true, mode: "all" });
    else if (tab === "active") setFilters({ mode: "takeover", unreadOnly: false });
    else setFilters({ mode: "all", unreadOnly: false });
  };

  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: displayRows.length,
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
      {/* Header: primary tabs · search · temperature triage */}
      <div className="space-y-2.5 border-b border-border/60 p-3">
        <div
          className="flex items-center gap-1 rounded-lg bg-muted/40 p-0.5"
          role="tablist"
          aria-label={t("list.tabsAria")}
        >
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setTab(tab)}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors",
                activeTab === tab
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`list.tabs.${tab}`)}
            </button>
          ))}
        </div>
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
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted/40 p-0.5"
            role="group"
            aria-label={t("list.assigneeAria")}
          >
            {ASSIGNEE_FILTERS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={filters.assignee === a}
                onClick={() => setFilters({ assignee: a })}
                className={cn(
                  "rounded-md px-2 py-1 text-[12px] font-semibold transition-colors",
                  filters.assignee === a
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`list.assignee.${a}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {TEMP_FILTERS.map((f) => {
            const count = tempCountFor(f);
            const selected = temp === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setTemp(f)}
                aria-pressed={selected}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors",
                  selected
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn("size-1.5 rounded-full", TEMP_DOT[f])}
                  aria-hidden
                />
                <span className="truncate">{t(`list.temp.${f}`)}</span>
                <span className="tabular-nums font-semibold">{count}</span>
              </button>
            );
          })}
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
        {isLoading && displayRows.length === 0 ? (
          <div className="space-y-0 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : displayRows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {temp === "all" ? t("list.empty") : t("list.emptyTemp")}
          </div>
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const row = displayRows[vi.index]!;
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
                    pulse={pulsedIds?.has(row.id) ?? false}
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
  pulse,
}: {
  row: InboxConversation;
  active: boolean;
  onSelect: (id: string) => void;
  pulse: boolean;
}) {
  const t = useTranslations("tgInbox");
  const temp = temperatureOf(row, Date.now());
  const previewText = row.lastMessageText ?? "";
  const tgFullName = [row.contactFirstName, row.contactLastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const name =
    row.patient?.fullName ||
    tgFullName ||
    (row.contactUsername ? `@${row.contactUsername}` : null) ||
    row.externalId ||
    t("list.anonymous");
  const subline =
    row.contactUsername && (row.patient?.fullName || tgFullName)
      ? `@${row.contactUsername}`
      : row.externalId && (row.patient?.fullName || tgFullName || row.contactUsername)
        ? `id ${row.externalId}`
        : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      key={pulse ? "pulse" : "idle"}
      className={cn(
        "relative mx-1.5 flex w-[calc(100%-12px)] items-start gap-3 rounded-xl px-2.5 py-2.5 text-left",
        "transition-[background-color,box-shadow] duration-[var(--motion-dur-fast)] ease-out",
        active
          ? "bg-primary/10 shadow-sm shadow-primary/5"
          : "hover:bg-muted/60",
        pulse && "tg-row-pulse",
      )}
    >
      {temp === "hot" || temp === "warm" ? (
        <span
          className={cn(
            "absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-full",
            temp === "hot" ? "bg-destructive" : "bg-[color:var(--warning)]",
          )}
          aria-hidden
        />
      ) : null}
      <AvatarWithStatus
        name={name}
        src={row.patient?.photoUrl ?? null}
        status={row.unreadCount > 0 ? "online" : null}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">
              {name}
            </div>
            {subline ? (
              <div className="truncate text-[11px] text-muted-foreground">
                {subline}
              </div>
            ) : null}
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
