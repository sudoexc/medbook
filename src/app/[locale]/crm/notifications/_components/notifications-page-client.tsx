"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";
import { SectionHeader } from "@/components/molecules/section-header";

import { useQueue, useNotificationsStats } from "../_hooks/use-queue";
import type { TemplateChannel } from "../_hooks/types";

import { NotificationsSubNav } from "./notifications-sub-nav";
import {
  NotificationsTypesSidebar,
  type ChannelFilter,
} from "./notifications-types-sidebar";
import { NotificationsKpiStrip } from "./notifications-kpi-strip";
import { NotificationsActivityList } from "./notifications-activity-list";
import { NotificationsDetailsRail } from "./notifications-details-rail";

const CHANNELS: TemplateChannel[] = ["SMS", "TG", "EMAIL", "CALL", "VISIT"];

function isChannel(v: string | null | undefined): v is TemplateChannel {
  return v !== null && v !== undefined && (CHANNELS as string[]).includes(v);
}

/**
 * 3-column Notifications activity layout — see `docs/TZ.md` §6.9.
 *
 *   280px   | 1fr              | 360px
 *   types   | KPI + activity   | details
 *
 * Left: channel filter with counts. Center: sub-nav + today's KPI strip +
 * scrollable activity feed. Right: patient + channel + timeline + 30d stats
 * for the selected send.
 */
export function NotificationsPageClient() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const searchParams = useSearchParams();

  const channelParam = searchParams?.get("channel") ?? null;
  const channel: ChannelFilter = isChannel(channelParam) ? channelParam : "all";
  const selectedId = searchParams?.get("id") ?? null;

  const setChannel = (next: ChannelFilter) => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "all") sp.delete("channel");
    else sp.set("channel", next);
    router.replace(`?${sp.toString()}`, { scroll: false });
  };
  const setSelected = (id: string | null) => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (id) sp.set("id", id);
    else sp.delete("id");
    router.replace(`?${sp.toString()}`, { scroll: false });
  };

  const queueQuery = useQueue(null);
  const statsQuery = useNotificationsStats();

  const allRows = React.useMemo(
    () => queueQuery.data?.rows ?? [],
    [queueQuery.data],
  );
  const filteredRows = React.useMemo(
    () =>
      channel === "all"
        ? allRows
        : allRows.filter((row) => row.channel === channel),
    [allRows, channel],
  );

  const selectedRow = React.useMemo(
    () => filteredRows.find((row) => row.id === selectedId) ?? null,
    [filteredRows, selectedId],
  );

  return (
    <>
      <div className="flex min-h-[60vh] items-center justify-center p-6 xl:hidden">
        <EmptyState
          icon={<BellIcon />}
          title={t("desktopOnly.title")}
          description={t("desktopOnly.description")}
        />
      </div>

      <div className="hidden min-h-0 flex-1 xl:flex">
        <aside
          className="flex w-[280px] shrink-0 flex-col border-r border-border bg-card"
          aria-label={t("types.title")}
        >
          <NotificationsTypesSidebar
            rows={allRows}
            active={channel}
            onChange={setChannel}
            isLoading={queueQuery.isLoading}
          />
        </aside>

        <section
          className="flex min-w-0 flex-1 flex-col bg-background"
          aria-label={t("activity.ariaLabel")}
        >
          <div className="flex flex-col gap-3 px-4 pt-4">
            <SectionHeader title={t("title")} subtitle={t("subtitle")} />
            <NotificationsSubNav active="activity" />
            <NotificationsKpiStrip />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NotificationsActivityList
              rows={filteredRows}
              isLoading={queueQuery.isLoading}
              selectedId={selectedId}
              onSelect={setSelected}
            />
          </div>
        </section>

        <aside
          className="flex w-[360px] shrink-0 flex-col border-l border-border bg-card"
          aria-label={t("details.ariaLabel")}
        >
          <NotificationsDetailsRail row={selectedRow} stats={statsQuery.data} />
        </aside>
      </div>
    </>
  );
}
