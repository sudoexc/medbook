"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";

export interface QueueColumnProps {
  rows: AppointmentRow[];
  className?: string;
}

const QUEUE_STATUSES = new Set(["BOOKED", "WAITING", "CONFIRMED"]);

/**
 * "Общая очередь" — narrow left column listing today's waiting patients.
 * Matches the mockup 1 — Ресепшн: compact avatar + name + service + time.
 */
export function QueueColumn({ rows, className }: QueueColumnProps) {
  const queue = React.useMemo(
    () =>
      rows
        .filter((r) => QUEUE_STATUSES.has(r.status))
        .sort(
          (a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime(),
        ),
    [rows],
  );

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-2xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Общая очередь
        </h3>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
          {queue.length}
        </span>
      </header>
      <ol className="flex-1 divide-y divide-border overflow-y-auto">
        {queue.length === 0 ? (
          <li className="px-4 py-8 text-center text-xs text-muted-foreground">
            Очередь пуста
          </li>
        ) : (
          queue.map((row, i) => (
            <QueueItem key={row.id} index={i + 1} row={row} />
          ))
        )}
      </ol>
    </section>
  );
}

function QueueItem({ index, row }: { index: number; row: AppointmentRow }) {
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(row.date));

  return (
    <li>
      <Link
        href={`?ap=${row.id}`}
        scroll={false}
        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60"
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
          <div className="truncate text-sm font-semibold text-foreground">
            {row.patient.fullName}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {row.primaryService?.nameRu ?? row.doctor.nameRu}
          </div>
        </div>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          {time}
        </span>
      </Link>
    </li>
  );
}
