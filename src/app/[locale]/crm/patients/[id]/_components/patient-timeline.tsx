"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarIcon,
  FilterIcon,
  MessageCircleIcon,
  PhoneIcon,
  SendIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/atoms/money-text";

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

type Tab = { key: CommunicationFilter; tKey: string };

const TABS: Tab[] = [
  { key: "ALL", tKey: "tabAll" },
  { key: "VISIT", tKey: "tabVisits" },
  { key: "CALL", tKey: "tabCalls" },
  { key: "TG", tKey: "tabTelegram" },
];

function iconFor(item: CommunicationItem): {
  icon: LucideIcon;
  bg: string;
  fg: string;
} {
  if (item.kind === "visit")
    return {
      icon: CalendarIcon,
      bg: "bg-primary/10",
      fg: "text-primary",
    };
  if (item.channel === "TG" || item.kind === "message")
    return {
      icon: SendIcon,
      bg: "bg-info/15",
      fg: "text-info",
    };
  if (item.channel === "CALL" || item.kind === "call")
    return {
      icon: PhoneIcon,
      bg: "bg-warning/15",
      fg: "text-warning",
    };
  if (item.channel === "SMS")
    return {
      icon: MessageCircleIcon,
      bg: "bg-muted",
      fg: "text-muted-foreground",
    };
  return {
    icon: UsersIcon,
    bg: "bg-muted",
    fg: "text-muted-foreground",
  };
}

function metaOf(item: CommunicationItem): {
  meta: React.ReactNode;
  status?: { tKey: string; tone: "success" | "muted" | "info" };
  right?: React.ReactNode;
} {
  const m = item.meta as Record<string, unknown> | null | undefined;
  if (item.kind === "visit") {
    const price = m && typeof m["priceFinal"] === "number" ? (m["priceFinal"] as number) : null;
    const status = m && typeof m["status"] === "string" ? (m["status"] as string) : null;
    return {
      meta: m?.["doctor"] ? String((m["doctor"] as { nameRu?: string }).nameRu ?? "") : "",
      status:
        status === "COMPLETED"
          ? { tKey: "statusCompleted", tone: "success" }
          : status === "CANCELLED"
            ? { tKey: "statusCancelled", tone: "muted" }
            : undefined,
      right: price ? <MoneyText amount={price} currency="UZS" /> : null,
    };
  }
  if (item.channel === "CALL" || item.kind === "call") {
    const missed = item.direction === "MISSED";
    return {
      meta: item.body ?? "",
      status: {
        tKey: missed ? "callMissed" : "callAnswered",
        tone: missed ? "muted" : "success",
      },
    };
  }
  if (item.channel === "TG") {
    return {
      meta: item.body ?? "",
      status: {
        tKey: item.direction === "IN" ? "incoming" : "outgoing",
        tone: "info",
      },
    };
  }
  return { meta: item.body ?? "" };
}

/**
 * "История взаимодействий" timeline — docs/7 - Карточка пациента.png.
 */
export function PatientTimeline({ patientId, className }: PatientTimelineProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("patientCard.timeline");
  const q = usePatientCommunications(patientId);
  const [tab, setTab] = React.useState<CommunicationFilter>("ALL");
  const [showAll, setShowAll] = React.useState(false);

  const items = filterTimeline(q.data?.items, tab);
  const shownLimit = 7;
  const shown = showAll ? items : items.slice(0, shownLimit);
  const hidden = Math.max(0, items.length - shown.length);

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
        <Button variant="outline" size="sm" className="h-7 text-[11px]">
          <FilterIcon className="size-3.5" />
          {t("filter")}
        </Button>
      </div>

      <div
        role="tablist"
        aria-label={t("typeTabs")}
        className="mt-2 inline-flex w-fit gap-1 rounded-lg bg-muted/50 p-0.5 text-[12px]"
      >
        {TABS.map((tab_) => {
          const active = tab === tab_.key;
          return (
            <button
              key={tab_.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(tab_.key)}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(tab_.tKey as never)}
            </button>
          );
        })}
      </div>

      <ul className="mt-3 space-y-2">
        {q.isLoading ? (
          <li className="text-[12px] text-muted-foreground">{t("loading")}</li>
        ) : shown.length === 0 ? (
          <li className="text-[12px] text-muted-foreground">
            {t("empty")}
          </li>
        ) : (
          shown.map((item) => {
            const tone = iconFor(item);
            const Icon = tone.icon;
            const info = metaOf(item);
            return (
              <li
                key={item.id}
                className="grid grid-cols-[8px_40px_minmax(100px,1fr)_minmax(140px,1.4fr)_minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-1 py-1.5 text-[12px] hover:bg-muted/30"
              >
                <span
                  className="mt-1.5 inline-block size-2 rounded-full bg-success"
                  aria-hidden
                />
                <span
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                    tone.bg,
                    tone.fg,
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 text-foreground">
                  <div className="truncate tabular-nums font-semibold">
                    {formatDate(item.at, locale, "short")}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground tabular-nums">
                    {new Date(item.at).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-foreground">
                    {item.title}
                  </div>
                  {info.meta ? (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {info.meta}
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 truncate text-right text-foreground tabular-nums">
                  {info.right ?? (
                    <span className="text-muted-foreground">
                      {item.body ?? ""}
                    </span>
                  )}
                </div>
                <div className="shrink-0">
                  {info.status ? (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold",
                        info.status.tone === "success"
                          ? "bg-success/15 text-success"
                          : info.status.tone === "info"
                            ? "bg-info/15 text-info"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {t(info.status.tKey as never)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })
        )}
      </ul>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-[12px] font-semibold text-primary hover:bg-primary/5"
        >
          {t("showMore", { count: hidden })}
        </button>
      ) : null}
    </section>
  );
}
