"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BanknoteIcon,
  BellIcon,
  CalendarSyncIcon,
  ClipboardListIcon,
  FileTextIcon,
  HistoryIcon,
  PhoneIcon,
  SendIcon,
  StethoscopeIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/atoms/empty-state";
import { MoneyText } from "@/components/atoms/money-text";
import { groupByDay, type DayGroup } from "@/lib/timeline/group-by-day";

import {
  filterTimeline,
  usePatientCommunications,
  type CommunicationFilter,
  type CommunicationItem,
} from "../_hooks/use-patient-communications";

export interface PatientTimelineProps {
  patientId: string;
  className?: string;
}

type TabKey = Extract<
  CommunicationFilter,
  "ALL" | "VISIT" | "PAYMENT" | "COMM" | "DOC"
>;

const TABS: TabKey[] = ["ALL", "VISIT", "PAYMENT", "COMM", "DOC"];

type IconTone = {
  icon: LucideIcon;
  bg: string;
  fg: string;
};

function iconFor(item: CommunicationItem): IconTone {
  if (item.kind === "visit")
    return { icon: StethoscopeIcon, bg: "bg-primary/10", fg: "text-primary" };
  if (item.kind === "payment")
    return { icon: BanknoteIcon, bg: "bg-success/15", fg: "text-success" };
  if (item.kind === "document")
    return { icon: FileTextIcon, bg: "bg-muted", fg: "text-foreground" };
  if (item.kind === "case")
    return {
      icon: ClipboardListIcon,
      bg: "bg-info/15",
      fg: "text-info",
    };
  if (item.kind === "reschedule")
    return {
      icon: CalendarSyncIcon,
      bg: "bg-warning/15",
      fg: "text-warning",
    };
  if (item.kind === "notification")
    return { icon: BellIcon, bg: "bg-muted", fg: "text-muted-foreground" };
  if (item.kind === "call" || item.channel === "CALL")
    return { icon: PhoneIcon, bg: "bg-warning/15", fg: "text-warning" };
  if (item.kind === "message" || item.channel === "TG")
    return { icon: SendIcon, bg: "bg-info/15", fg: "text-info" };
  return { icon: BellIcon, bg: "bg-muted", fg: "text-muted-foreground" };
}

type RowMeta = {
  body: React.ReactNode;
  right?: React.ReactNode;
};

function metaOf(item: CommunicationItem, locale: Locale): RowMeta {
  const m = (item.meta ?? null) as Record<string, unknown> | null;

  if (item.kind === "visit") {
    const doctor =
      m && typeof m["doctor"] === "object" && m["doctor"] !== null
        ? ((m["doctor"] as { nameRu?: string }).nameRu ?? "")
        : "";
    const price =
      m && typeof m["priceFinal"] === "number"
        ? (m["priceFinal"] as number)
        : null;
    return {
      body: doctor || (item.body ?? ""),
      right:
        price !== null ? (
          <MoneyText amount={price} currency="UZS" locale={locale} />
        ) : null,
    };
  }

  if (item.kind === "payment") {
    const amount =
      m && typeof m["amount"] === "number" ? (m["amount"] as number) : null;
    const method =
      m && typeof m["method"] === "string" ? (m["method"] as string) : null;
    return {
      body: method ?? item.body ?? "",
      right:
        amount !== null ? (
          <MoneyText amount={amount} currency="UZS" locale={locale} />
        ) : null,
    };
  }

  return { body: item.body ?? "" };
}

function rowTitle(
  item: CommunicationItem,
  t: (key: string) => string,
): string {
  if (item.title && item.title.trim().length > 0) return item.title;
  switch (item.kind) {
    case "visit":
      return t("kinds.VISIT.title");
    case "payment":
      return t("kinds.PAYMENT.title");
    case "document":
      return t("kinds.DOCUMENT.title");
    case "notification":
      return t("kinds.NOTIFICATION.title");
    case "call":
      return t("kinds.CALL.title");
    case "message":
      return t("kinds.TG.title");
    case "case":
      return t("kinds.CASE.title");
    case "reschedule":
      return t("kinds.RESCHEDULE.title");
    default:
      return "";
  }
}

function dayHeader(
  group: DayGroup<CommunicationItem>,
  locale: Locale,
  t: (key: string) => string,
): string {
  if (group.label === "today") return t("dayHeader.today");
  if (group.label === "yesterday") return t("dayHeader.yesterday");
  return formatDate(group.date, locale, "long");
}

function TimelineSkeleton() {
  return (
    <div className="mt-3 space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Phase 12 unified patient timeline.
 *
 * Shows every event kind (visit / payment / document / call / TG / case /
 * reschedule / notification) in a single chronological feed, grouped by day
 * with relative headers ("Сегодня", "Вчера", absolute date for older days)
 * and filterable via tabs (ALL / VISIT / PAYMENT / COMM / DOC).
 */
export function PatientTimeline({ patientId, className }: PatientTimelineProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("patientTimeline");
  const q = usePatientCommunications(patientId);
  const [tab, setTab] = React.useState<TabKey>("ALL");

  const items = filterTimeline(q.data?.items, tab);
  const groups = React.useMemo(
    () =>
      groupByDay<CommunicationItem>(
        items.map((it) => ({ ...it })),
        new Date(),
      ),
    [items],
  );

  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">
          {t("title")}
        </h3>
      </div>

      <div
        role="tablist"
        aria-label={t("typeTabs")}
        className="mt-2 inline-flex w-fit gap-1 rounded-lg bg-muted/50 p-0.5 text-[12px]"
      >
        {TABS.map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tabs.${key}` as never)}
            </button>
          );
        })}
      </div>

      {q.isLoading ? (
        <TimelineSkeleton />
      ) : groups.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            icon={<HistoryIcon />}
            title={t(`empty.${tab}` as never)}
          />
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {dayHeader(group, locale, (k) => t(k as never))}
              </div>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item) => {
                  const tone = iconFor(item);
                  const Icon = tone.icon;
                  const info = metaOf(item, locale);
                  const title = rowTitle(item, (k) => t(k as never));
                  return (
                    <li
                      key={item.id}
                      className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 rounded-lg px-1 py-1.5 text-[12px] hover:bg-muted/30"
                    >
                      <span
                        className={cn(
                          "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                          tone.bg,
                          tone.fg,
                        )}
                        aria-hidden
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">
                          {title}
                        </div>
                        {info.body ? (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {info.body}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end gap-0.5 text-right">
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {formatDate(item.at, locale, "time")}
                        </span>
                        {info.right ? (
                          <span className="text-[12px] font-semibold text-foreground tabular-nums">
                            {info.right}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
