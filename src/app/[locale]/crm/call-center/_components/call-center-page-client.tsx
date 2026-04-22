"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { PhoneCallIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";

import { useIncomingCalls } from "../_hooks/use-incoming-calls";
import { useActiveCall, useActiveCallId } from "../_hooks/use-active-call";
import {
  flattenHistory,
  useCallHistory,
  useHistoryFilters,
} from "../_hooks/use-call-history";

import { IncomingQueue } from "./incoming-queue";
import { ActiveCall } from "./active-call";
import { CallHistory } from "./call-history";

/**
 * 3-column Call Center layout — see `docs/TZ.md` §6.7.
 *
 *   320px | 1fr | 380px
 *   queue | active | history
 *
 * ≥1280px only. Below that we render a polite "use desktop" hint — same as
 * `/crm/telegram` and `/crm/calendar`.
 *
 * State plumbing:
 *   - Ringing queue + history poll their own endpoints on separate cadences.
 *   - The middle column is driven by `?active=<callId>` URL param.
 *   - Auto-select: when no call is active but one is ringing, we pick the
 *     oldest so the operator never stares at an empty middle column.
 */
export function CallCenterPageClient() {
  const t = useTranslations("callCenter");

  const incomingQuery = useIncomingCalls();
  const incoming = incomingQuery.data ?? [];

  const [activeId, setActiveId] = useActiveCallId();
  const activeQuery = useActiveCall(activeId);

  const { filters, setFilters, reset } = useHistoryFilters();
  const historyQuery = useCallHistory(filters);
  const historyRows = flattenHistory(historyQuery.data?.pages);

  // Auto-select the oldest ringing call on first load if nothing is active.
  React.useEffect(() => {
    if (!activeId && incoming.length > 0) {
      // "oldest" = lowest createdAt; server returns desc so take the tail.
      const oldest = [...incoming].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0];
      if (oldest) setActiveId(oldest.id);
    }
  }, [activeId, incoming, setActiveId]);

  return (
    <>
      {/* Mobile fallback */}
      <div className="flex min-h-[60vh] items-center justify-center p-6 xl:hidden">
        <EmptyState
          icon={<PhoneCallIcon />}
          title={t("desktopOnly.title")}
          description={t("desktopOnly.description")}
        />
      </div>

      {/* Desktop 3-column layout */}
      <div className="hidden min-h-0 flex-1 xl:flex">
        <aside
          className="flex w-[320px] shrink-0 flex-col border-r border-border bg-card"
          aria-label={t("queue.ariaLabel")}
        >
          <IncomingQueue
            rows={incoming}
            selectedId={activeId}
            onSelect={setActiveId}
            isLoading={incomingQuery.isLoading}
          />
        </aside>

        <section
          className="flex min-w-0 flex-1 flex-col bg-background"
          aria-label={t("active.ariaLabel")}
        >
          <ActiveCall call={activeQuery.data ?? null} />
        </section>

        <aside
          className="flex w-[380px] shrink-0 flex-col border-l border-border bg-card"
          aria-label={t("history.ariaLabel")}
        >
          <CallHistory
            rows={historyRows}
            filters={filters}
            setFilters={setFilters}
            onReset={reset}
            selectedId={activeId}
            onSelect={setActiveId}
            isLoading={historyQuery.isLoading}
            hasNextPage={Boolean(historyQuery.hasNextPage)}
            onFetchNext={() => {
              if (historyQuery.hasNextPage && !historyQuery.isFetchingNextPage) {
                void historyQuery.fetchNextPage();
              }
            }}
          />
        </aside>
      </div>
    </>
  );
}
