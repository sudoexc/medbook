"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  PhoneIncomingIcon,
  PhoneOffIcon,
  CalendarPlusIcon,
  CheckIcon,
  ChevronRightIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { PhoneText } from "@/components/atoms/phone-text";

import type { CallRow } from "../_hooks/use-reception-live";

export interface CallsWidgetProps {
  rows: CallRow[];
  isLoading: boolean;
  onQuickAppointment: (prefill: {
    patientId: string | null;
    phone: string | null;
  }) => void;
  className?: string;
}

/**
 * "CALL CENTER" widget — docs/1-Ресепшн mockup.
 *
 * Layout:
 *  - header: "CALL CENTER" + unread badge
 *  - hero: first active incoming call with VIP badge + Принять / Отклонить /
 *    Записать CTAs
 *  - queue: compact list of remaining queued/recent calls
 *  - footer: "Все звонки →"
 */
export function CallsWidget({
  rows,
  isLoading,
  onQuickAppointment,
  className,
}: CallsWidgetProps) {
  const t = useTranslations("reception.calls");

  const active = rows.filter((c) => !c.endedAt);
  const hero = active[0] ?? null;
  const queued = (hero ? active.slice(1) : active).slice(0, 3);
  const recent = rows.filter((c) => c.endedAt).slice(0, 3);
  const queueList = [...queued, ...recent].slice(0, 4);

  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Call Center
          </h3>
          {active.length > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
              {active.length}
            </span>
          ) : null}
        </div>
        <Link
          href="/crm/call-center"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          Все
          <ChevronRightIcon className="size-3" />
        </Link>
      </header>

      <div className="flex flex-col gap-3 p-4">
        {isLoading ? (
          <div className="h-36 animate-pulse rounded-xl bg-muted" aria-hidden />
        ) : hero ? (
          <HeroCall
            row={hero}
            onAnswer={() =>
              onQuickAppointment({
                patientId: hero.patient?.id ?? null,
                phone: hero.fromNumber,
              })
            }
          />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-6 text-center">
            <PhoneIncomingIcon className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">
              Нет активных звонков
            </p>
            <p className="text-xs text-muted-foreground">
              Очередь пуста — можно передохнуть
            </p>
          </div>
        )}

        {queueList.length > 0 ? (
          <div className="flex flex-col">
            <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Очередь звонков
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {queueList.map((row) => (
                <QueueCallRow key={row.id} row={row} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HeroCall({
  row,
  onAnswer,
}: {
  row: CallRow;
  onAnswer: () => void;
}) {
  const isVip = row.patient && /VIP/i.test(row.patient.fullName); // lightweight flag
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--destructive)]">
          Входящий звонок
        </span>
      </div>
      <div className="flex items-center gap-3">
        <AvatarWithStatus
          name={row.patient?.fullName ?? "?"}
          size="lg"
          status="busy"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-lg font-bold text-foreground">
              {row.patient?.fullName ?? "Неизвестный номер"}
            </p>
            {isVip ? (
              <span className="inline-flex items-center rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--warning)]">
                VIP
              </span>
            ) : row.patient ? (
              <span className="inline-flex items-center rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[color:var(--success)]">
                Клиент
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                Новый
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            <PhoneText phone={row.fromNumber} asText />
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="default"
          className="flex-1 bg-success text-success-foreground hover:bg-success/90"
          onClick={onAnswer}
        >
          <CheckIcon className="size-4" />
          Принять
        </Button>
        <Button size="icon" variant="secondary" aria-label="Отклонить">
          <PhoneOffIcon className="size-4" />
        </Button>
        <Button size="icon" variant="secondary" aria-label="Быстрая запись">
          <CalendarPlusIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function QueueCallRow({ row }: { row: CallRow }) {
  const duration = row.durationSec;
  const durationLabel =
    duration != null
      ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`
      : row.endedAt == null
        ? "сейчас"
        : "—";
  return (
    <li className="flex items-center gap-2.5 px-3 py-2.5">
      <AvatarWithStatus
        name={row.patient?.fullName ?? "?"}
        size="sm"
        status={row.endedAt ? "offline" : "online"}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {row.patient?.fullName ?? "Неизвестный"}
        </p>
        <p className="truncate text-[11px] text-muted-foreground tabular-nums">
          <PhoneText phone={row.fromNumber} asText />
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-[11px] font-semibold tabular-nums",
          row.endedAt ? "text-muted-foreground" : "text-[color:var(--success)]",
        )}
      >
        {durationLabel}
      </span>
    </li>
  );
}
