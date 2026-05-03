"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { SparklesIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import { type AiQueueItem, useAiQueueScores } from "../_hooks/use-reception-live";

export interface QueueColumnProps {
  rows: AppointmentRow[];
  className?: string;
}

const QUEUE_STATUSES = new Set(["BOOKED", "WAITING", "CONFIRMED"]);

type Band = AiQueueItem["score"]["band"];

const BAND_ACCENT: Record<Band, string> = {
  critical: "before:bg-destructive",
  high: "before:bg-warning",
  normal: "before:bg-primary/40",
  low: "before:bg-muted-foreground/30",
};

export function QueueColumn({ rows, className }: QueueColumnProps) {
  const t = useTranslations("reception.queueColumn");
  const locale = useLocale();
  const aiScores = useAiQueueScores();

  const scoreMap = React.useMemo(() => {
    const m = new Map<string, AiQueueItem>();
    for (const it of aiScores.data ?? []) m.set(it.appointmentId, it);
    return m;
  }, [aiScores.data]);

  const aiActive = scoreMap.size > 0;

  const queue = React.useMemo(() => {
    const filtered = rows.filter((r) => QUEUE_STATUSES.has(r.status));
    if (aiActive) {
      return filtered.slice().sort((a, b) => {
        const sa = scoreMap.get(a.id)?.score.score ?? -1;
        const sb = scoreMap.get(b.id)?.score.score ?? -1;
        if (sa !== sb) return sb - sa;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });
    }
    return filtered.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }, [rows, aiActive, scoreMap]);

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-2xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {t("title")}
          {aiActive ? (
            <span
              title={t("aiTooltip")}
              className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-normal text-primary"
            >
              <SparklesIcon className="size-2.5" />
              AI
            </span>
          ) : null}
        </h3>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
          {queue.length}
        </span>
      </header>
      <ol className="flex-1 divide-y divide-border overflow-y-auto">
        {queue.length === 0 ? (
          <li className="px-4 py-8 text-center text-xs text-muted-foreground">
            {t("empty")}
          </li>
        ) : (
          queue.map((row, i) => (
            <QueueItem
              key={row.id}
              index={i + 1}
              row={row}
              locale={locale}
              ai={scoreMap.get(row.id)}
            />
          ))
        )}
      </ol>
    </section>
  );
}

function QueueItem({
  index,
  row,
  locale,
  ai,
}: {
  index: number;
  row: AppointmentRow;
  locale: string;
  ai: AiQueueItem | undefined;
}) {
  const time = new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(row.date));

  const band = ai?.score.band;
  const noShowPct = ai ? Math.round(ai.noShowRisk * 100) : 0;
  const showRisk = ai && noShowPct >= 40;

  return (
    <li>
      <Link
        href={`?ap=${row.id}`}
        scroll={false}
        className={cn(
          "relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60",
          band &&
            "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full",
          band ? BAND_ACCENT[band] : "",
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
          {index}
        </span>
        <AvatarWithStatus
          name={row.patient.fullName}
          src={row.patient.photoUrl}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {row.patient.fullName}
            </span>
            {ai?.isVip ? (
              <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                VIP
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
            <span className="truncate">
              {locale === "uz"
                ? row.primaryService?.nameUz ?? row.doctor.nameUz
                : row.primaryService?.nameRu ?? row.doctor.nameRu}
            </span>
            {showRisk ? (
              <span className="shrink-0 text-[10px] font-medium text-warning">
                · {noShowPct}%
              </span>
            ) : null}
          </div>
        </div>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          {time}
        </span>
      </Link>
    </li>
  );
}
