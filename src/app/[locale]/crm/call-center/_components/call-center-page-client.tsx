"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { PhoneCallIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";

import {
  useCallCenterRealtime,
  useIncomingCalls,
} from "../_hooks/use-incoming-calls";
import { useActiveCall, useActiveCallId } from "../_hooks/use-active-call";

import { IncomingQueue } from "./incoming-queue";
import { ActiveCall } from "./active-call";
import { CallActionsRail } from "./call-actions-rail";

/**
 * 3-column Call Center layout — see `docs/6 - Call Center.png` and `docs/TZ.md` §6.7.
 *
 *   320px | 1fr      | 380px
 *   queue | context  | controls + AI + scripts
 *
 * Left: ringing queue (polled). Center: linked patient context — LTV KPIs,
 * next-appointment, booking CTA, visit history, notes. Right: operator
 * controls (hangup / mark-missed / SIP stubs / SMS) plus AI hints and canned
 * scripts the operator can copy while talking.
 *
 * Auto-select: when no call is active but one is ringing, pick the oldest so
 * the operator never stares at an empty middle column.
 */
export function CallCenterPageClient() {
  const t = useTranslations("callCenter");

  const incomingQuery = useIncomingCalls();
  const incoming = React.useMemo(
    () => incomingQuery.data ?? [],
    [incomingQuery.data],
  );

  const [activeId, setActiveId] = useActiveCallId();
  useCallCenterRealtime(activeId);

  const activeQuery = useActiveCall(activeId);

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
            isFetching={incomingQuery.isFetching}
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
          aria-label={t("actionsRail.ariaLabel")}
        >
          <CallActionsRail call={activeQuery.data ?? null} />
        </aside>
      </div>
    </>
  );
}
