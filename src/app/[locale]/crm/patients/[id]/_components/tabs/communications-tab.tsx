"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckIcon,
  InboxIcon,
  MessageSquareIcon,
  PhoneIcon,
  SendIcon,
  StethoscopeIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { EmptyState } from "@/components/atoms/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { Patient } from "../../_hooks/use-patient";
import {
  filterTimeline,
  usePatientCommunications,
  type CommunicationFilter,
  type CommunicationItem,
} from "../../_hooks/use-patient-communications";

function channelIcon(item: CommunicationItem) {
  if (item.kind === "visit" || item.channel === "VISIT")
    return <StethoscopeIcon className="size-4" />;
  if (item.kind === "call" || item.channel === "CALL")
    return <PhoneIcon className="size-4" />;
  if (item.channel === "TG") return <SendIcon className="size-4" />;
  if (item.channel === "SMS") return <MessageSquareIcon className="size-4" />;
  return <CheckIcon className="size-4" />;
}

function itemTone(item: CommunicationItem): string {
  if (item.direction === "IN") return "bg-info/15 text-info";
  if (item.direction === "OUT") return "bg-primary/15 text-primary";
  if (item.kind === "visit")
    return "bg-success/15 text-success";
  return "bg-muted text-muted-foreground";
}

export interface CommunicationsTabProps {
  patient: Patient;
}

export function CommunicationsTab({ patient }: CommunicationsTabProps) {
  const t = useTranslations("patientCard.communications");
  const q = usePatientCommunications(patient.id);
  const [filter, setFilter] = React.useState<CommunicationFilter>("ALL");

  const filtered = React.useMemo(
    () => filterTimeline(q.data?.items, filter),
    [q.data, filter],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {t("total", { count: q.data?.items.length ?? 0 })}
        </div>
        <Select
          value={filter}
          onValueChange={(v) => setFilter(v as CommunicationFilter)}
        >
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue placeholder={t("filter")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("types.all")}</SelectItem>
            <SelectItem value="SMS">{t("types.sms")}</SelectItem>
            <SelectItem value="TG">{t("types.tg")}</SelectItem>
            <SelectItem value="CALL">{t("types.call")}</SelectItem>
            <SelectItem value="VISIT">{t("types.visit")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {q.isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          …
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<InboxIcon />} title={t("empty")} />
      ) : (
        <CommunicationsList items={filtered} />
      )}
    </div>
  );
}

export interface CommunicationsListProps {
  items: CommunicationItem[];
  compact?: boolean;
}

export function CommunicationsList({
  items,
  compact = false,
}: CommunicationsListProps) {
  const locale = useLocale() as Locale;
  return (
    <ol
      className={cn(
        "flex flex-col",
        compact ? "divide-y divide-border" : "gap-2",
      )}
    >
      {items.map((it) => (
        <li
          key={it.id}
          className={cn(
            "flex items-start gap-3",
            compact
              ? "py-2 first:pt-0 last:pb-0"
              : "rounded-xl border border-border bg-card p-3",
          )}
        >
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-full",
              itemTone(it),
            )}
            aria-hidden
          >
            {channelIcon(it)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-sm font-medium text-foreground">
                {it.title}
              </div>
              <time className="shrink-0 text-xs text-muted-foreground">
                {formatDate(it.at, locale, "relative")}
              </time>
            </div>
            {it.body ? (
              <div
                className={cn(
                  "mt-0.5 text-sm text-muted-foreground",
                  compact ? "line-clamp-1" : "line-clamp-2",
                )}
              >
                {it.body}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
