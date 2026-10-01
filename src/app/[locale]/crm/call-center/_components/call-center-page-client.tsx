"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PhoneCallIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";
import { isCalledBack } from "@/lib/calls/call-state";
import { pickQueueTab, type QueueTab } from "@/lib/calls/queue-tab";
import { cn } from "@/lib/utils";

import {
  useCallCenterRealtime,
  useIncomingCalls,
} from "../_hooks/use-incoming-calls";
import { useActiveCall, useActiveCallId } from "../_hooks/use-active-call";
import { useMissedCalls } from "../_hooks/use-missed-calls";

import { IncomingQueue } from "./incoming-queue";
import { MissedCallsList } from "./missed-calls-list";
import { ActiveCall } from "./active-call";
import { CallActionsRail } from "./call-actions-rail";
import { UnconfirmedWidget } from "./unconfirmed-widget";

/**
 * 3-column Call Center layout — see `docs/6 - Call Center.png` and `docs/TZ.md` §6.7.
 *
 *   320px | 1fr      | 380px
 *   queue | context  | controls + AI + scripts
 *
 * Left: ringing queue and today's missed calls (tabs). Center: linked
 * patient context — LTV KPIs, next-appointment, booking CTA, visit history,
 * notes. Right: operator controls (hangup / mark-missed / SIP stubs / SMS)
 * plus AI hints and canned scripts the operator can copy while talking.
 *
 * Auto-select: when no call is active but one is ringing, pick the oldest so
 * the operator never stares at an empty middle column.
 */
export function CallCenterPageClient() {
  const t = useTranslations("callCenter");
  const router = useRouter();
  const searchParams = useSearchParams();

  const incomingQuery = useIncomingCalls();
  const incoming = React.useMemo(
    () => incomingQuery.data ?? [],
    [incomingQuery.data],
  );
  const missedQuery = useMissedCalls();
  const missed = React.useMemo(() => missedQuery.data ?? [], [missedQuery.data]);
  const pendingMissedCount = React.useMemo(
    () => missed.filter((r) => !isCalledBack(r.tags)).length,
    [missed],
  );

  const [activeId, setActiveId] = useActiveCallId();
  useCallCenterRealtime(activeId);

  const activeQuery = useActiveCall(activeId);

  const tab = pickQueueTab({
    tabParam: searchParams?.get("tab") ?? null,
    intentParam: searchParams?.get("intent") ?? null,
    ringingCount: incoming.length,
    pendingMissedCount,
  });
  const setTab = React.useCallback(
    (next: QueueTab) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      sp.set("tab", next);
      sp.delete("intent");
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  React.useEffect(() => {
    if (!activeId && incoming.length > 0) {
      const oldest = [...incoming].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0];
      if (oldest) setActiveId(oldest.id);
    }
  }, [activeId, incoming, setActiveId]);

  return (
    <>
      <div className="flex min-h-[60vh] items-center justify-center p-6 xl:hidden">
        <EmptyState
          icon={<PhoneCallIcon />}
          title={t("desktopOnly.title")}
          description={t("desktopOnly.description")}
        />
      </div>

      <div className="hidden min-h-0 flex-1 flex-col xl:flex">
        {/* Stage 2.F — "К подтверждению" widget. Sits above the 3-column
            workspace so it shares vertical space with the queue/active/rail
            trio without fighting them for width. Collapses to zero height
            when there are no open UNCONFIRMED_24H actions. */}
        <UnconfirmedWidget />

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-[320px] shrink-0 flex-col border-r border-border bg-card"
          aria-label={t("queue.ariaLabel")}
        >
          <div
            role="tablist"
            aria-label={t("queue.tabsAriaLabel")}
            className="flex gap-1 border-b border-border p-2"
          >
            <QueueTabButton
              selected={tab === "incoming"}
              onClick={() => setTab("incoming")}
              label={t("queue.title")}
              count={incoming.length}
            />
            <QueueTabButton
              selected={tab === "missed"}
              onClick={() => setTab("missed")}
              label={t("missed.title")}
              count={pendingMissedCount}
              tone="danger"
            />
          </div>
          {tab === "incoming" ? (
            <IncomingQueue
              rows={incoming}
              selectedId={activeId}
              onSelect={setActiveId}
              isLoading={incomingQuery.isLoading}
              isFetching={incomingQuery.isFetching}
              error={incomingQuery.error}
              showHeader={false}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <MissedCallsList
                rows={missed}
                selectedId={activeId}
                onSelect={setActiveId}
                isLoading={missedQuery.isLoading}
                error={missedQuery.error}
              />
            </div>
          )}
        </aside>

        <section
          className="flex min-w-0 flex-1 flex-col bg-background"
          aria-label={t("active.ariaLabel")}
        >
          <ActiveCall call={activeQuery.data ?? null} />
        </section>

        <aside
          className="flex w-[380px] shrink-0 flex-col border-l border-border bg-card"
          aria-label={t("actionsRail.ariaLabel")}
        >
          <CallActionsRail call={activeQuery.data ?? null} />
        </aside>
      </div>
      </div>
    </>
  );
}

function QueueTabButton({
  selected,
  onClick,
  label,
  count,
  tone = "muted",
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: "muted" | "danger";
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
        selected
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-px text-[11px] tabular-nums",
          count > 0 && tone === "danger"
            ? "bg-destructive text-destructive-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}
