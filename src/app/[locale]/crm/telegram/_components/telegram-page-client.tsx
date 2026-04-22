"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/atoms/empty-state";
import { SendIcon } from "lucide-react";

import {
  useConversations,
  useConversationsFilters,
  useSelectedConversationId,
  flattenConversations,
} from "../_hooks/use-conversations";
import { ConversationList } from "./conversation-list";
import { ChatPane } from "./chat-pane";
import { ChatRightRail } from "./chat-right-rail";

/**
 * 3-column Telegram inbox layout.
 *
 *   320px | 1fr | 340px
 *   list  | chat| rail
 *
 * Works only at ≥1280px; smaller widths get a "use desktop" hint.
 * When future phases need a mobile variant we swap this for a Sheet stack.
 */
export function TelegramPageClient() {
  const t = useTranslations("tgInbox");
  const { filters, setFilters } = useConversationsFilters();
  const [selectedId, setSelectedId] = useSelectedConversationId();

  const listQuery = useConversations(filters);
  const rows = flattenConversations(listQuery.data?.pages);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // On first load, auto-select the most recently active conversation so the
  // middle column isn't empty. We only do this when there's no `conv=` in the
  // URL — we never override an operator's explicit pick.
  React.useEffect(() => {
    if (!selectedId && rows.length > 0) {
      setSelectedId(rows[0]!.id);
    }
  }, [selectedId, rows, setSelectedId]);

  return (
    <>
      {/* Mobile fallback */}
      <div className="flex min-h-[60vh] items-center justify-center p-6 xl:hidden">
        <EmptyState
          icon={<SendIcon />}
          title={t("desktopOnly.title")}
          description={t("desktopOnly.description")}
        />
      </div>

      {/* Desktop 3-column inbox */}
      <div className="hidden min-h-0 flex-1 xl:flex">
        <aside
          className="flex w-[320px] shrink-0 flex-col border-r border-border bg-card"
          aria-label={t("list.ariaLabel")}
        >
          <ConversationList
            rows={rows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            filters={filters}
            setFilters={setFilters}
            isLoading={listQuery.isLoading}
            hasNextPage={Boolean(listQuery.hasNextPage)}
            onFetchNext={() => {
              if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
                void listQuery.fetchNextPage();
              }
            }}
          />
        </aside>

        <section
          className="flex min-w-0 flex-1 flex-col bg-background"
          aria-label={t("chat.ariaLabel")}
        >
          <ChatPane conversation={selected} />
        </section>

        <aside
          className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card"
          aria-label={t("rail.ariaLabel")}
        >
          <ChatRightRail conversation={selected} />
        </aside>
      </div>
    </>
  );
}
