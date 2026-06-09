"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  MegaphoneIcon,
  PlayIcon,
  RotateCcwIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import { useDoctorSchedule } from "../_hooks/use-doctor-schedule";
import type {
  ScheduleEntry,
  ScheduleType,
} from "../_hooks/use-doctor-today";
import { useAppointmentStatusMutation } from "../_hooks/use-appointment-status-mutation";

type MyDayTranslate = ReturnType<typeof useTranslations<"doctor.myDay">>;

const TYPE_LABEL_KEY: Record<ScheduleType, string> = {
  consultation: "type.consultation",
  repeat: "type.repeat",
  reserve: "type.reserve",
  break: "type.break",
};

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Headline label above the date — anchors "today" and "yesterday/tomorrow"
 * so the doctor can tell at a glance which day they're paging through
 * without re-reading the date string each time.
 */
function relativeLabel(
  view: Date,
  today: Date,
  t: MyDayTranslate,
): string | null {
  const delta = daysBetween(view, today);
  if (delta === 0) return t("schedule.today");
  if (delta === -1) return t("schedule.yesterday");
  if (delta === 1) return t("schedule.tomorrow");
  return null;
}

function fullDateLabel(view: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(view);
}

export function ScheduleCard() {
  const t = useTranslations("doctor.myDay");
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  const [viewDate, setViewDate] = React.useState<Date>(() =>
    startOfDay(new Date()),
  );
  const today = React.useMemo(() => startOfDay(new Date()), []);
  const isToday = daysBetween(viewDate, today) === 0;
  const dateKey = toIsoDate(viewDate);

  const { data, isLoading } = useDoctorSchedule(dateKey);
  const entries = data?.entries ?? [];

  const rel = relativeLabel(viewDate, today, t);
  const dateLine = fullDateLabel(viewDate);

  // Index of the first "next-up" slot — primary action target. Only the
  // very first eligible row gets the prominent "Старт" CTA so the doctor
  // isn't tempted to fire multiple receptions at once. Eligibility:
  // upcoming entry with a real patient (not break/reserve), only when
  // viewing today.
  const nextUpcomingIndex = React.useMemo(() => {
    if (!isToday) return -1;
    return entries.findIndex(
      (e) =>
        e.status === "upcoming" &&
        e.type !== "break" &&
        e.type !== "reserve" &&
        e.patientId != null,
    );
  }, [entries, isToday]);

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card xl:col-span-2">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <div className="text-[15px] font-semibold text-foreground">
            {rel ? `${rel} · ${dateLine}` : dateLine}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("schedule.subtitle")}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewDate(today)}
            disabled={isToday}
            className={cn(
              "motion-press inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium transition-colors",
              isToday
                ? "cursor-default text-muted-foreground opacity-60"
                : "text-foreground hover:bg-muted",
            )}
          >
            {t("schedule.today")}
          </button>
          <button
            type="button"
            aria-label={t("schedule.prevDay")}
            onClick={() => setViewDate((d) => addDays(d, -1))}
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("schedule.nextDay")}
            onClick={() => setViewDate((d) => addDays(d, 1))}
            className="motion-press flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRightIcon className="size-3.5" />
          </button>
        </div>
      </header>

      <ul className="flex-1 divide-y divide-border/60 px-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-4">
              <div className="w-14 shrink-0">
                <Skeleton className="h-5 w-11" />
              </div>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center">
                <Skeleton className="size-2.5 rounded-full" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-9 w-24 shrink-0 rounded-lg" />
            </li>
          ))
        ) : entries.length === 0 ? (
          <li className="px-5 py-12 text-center text-sm text-muted-foreground">
            {isToday ? t("schedule.emptyToday") : t("schedule.emptyDay")}
          </li>
        ) : (
          entries
            .slice(0, 10)
            .map((entry, i) => (
              <ScheduleRow
                key={entry.id}
                entry={entry}
                dateKey={dateKey}
                isToday={isToday}
                isNextUpcoming={i === nextUpcomingIndex}
              />
            ))
        )}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <Link
          href={`/${locale}/doctor/schedule?date=${dateKey}`}
          className="motion-press inline-flex w-full items-center justify-center gap-2 rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          <CalendarIcon className="size-4" />
          {t("schedule.showWholeDay")}
          {entries.length > 10 ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold">
              +{entries.length - 10}
            </span>
          ) : null}
        </Link>
      </footer>
    </section>
  );
}

function ScheduleRow({
  entry,
  dateKey,
  isToday,
  isNextUpcoming,
}: {
  entry: ScheduleEntry;
  dateKey: string;
  isToday: boolean;
  isNextUpcoming: boolean;
}) {
  const t = useTranslations("doctor.myDay");
  const mutation = useAppointmentStatusMutation(dateKey);
  const isBreak = entry.type === "break";
  const isReserve = entry.type === "reserve";
  const active = isToday && entry.status === "in_progress";
  const dimmed =
    entry.status === "no_show" ||
    entry.status === "cancelled" ||
    entry.status === "done";

  return (
    <li
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-4 transition-colors",
        active && "bg-primary/[0.04]",
        !active && !isBreak && !dimmed && "hover:bg-muted/50",
        dimmed && "opacity-75",
      )}
    >
      <div className="w-14 shrink-0 text-base font-semibold tabular-nums text-foreground">
        {entry.startTime}
      </div>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center">
        <span
          className={cn(
            "size-2.5 rounded-full",
            active
              ? "bg-success ring-2 ring-success/30"
              : isReserve
                ? "border-2 border-warning"
                : isBreak
                  ? "bg-muted-foreground/30"
                  : entry.status === "done"
                    ? "bg-success/60"
                    : entry.status === "no_show"
                      ? "bg-warning"
                      : entry.status === "cancelled"
                        ? "bg-destructive/60"
                        : "border-2 border-border",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-[15px] font-semibold",
            isBreak || isReserve
              ? "text-muted-foreground"
              : "text-foreground",
          )}
        >
          {entry.patientName ??
            (isBreak ? t("type.break") : t("schedule.unspecified"))}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {t(TYPE_LABEL_KEY[entry.type])}
          {entry.durationMin
            ? ` · ${t("schedule.durationMin", { n: entry.durationMin })}`
            : ""}
        </div>
      </div>
      <RowAction
        entry={entry}
        isNextUpcoming={isNextUpcoming}
        isToday={isToday}
        isPending={mutation.isPending}
        onFire={(toStatus, opts) =>
          mutation.mutate({
            appointmentId: entry.id,
            toStatus,
            revert: opts?.revert,
          })
        }
        onCall={() =>
          mutation.mutate({
            appointmentId: entry.id,
            // toStatus is ignored by the call branch — sentinel only.
            toStatus: "WAITING",
            call: true,
          })
        }
      />
    </li>
  );
}

function RowAction({
  entry,
  isNextUpcoming,
  isToday,
  isPending,
  onFire,
  onCall,
}: {
  entry: ScheduleEntry;
  isNextUpcoming: boolean;
  isToday: boolean;
  isPending: boolean;
  onFire: (
    toStatus: Parameters<
      ReturnType<typeof useAppointmentStatusMutation>["mutate"]
    >[0]["toStatus"],
    opts?: { revert?: boolean },
  ) => void;
  onCall: () => void;
}) {
  const t = useTranslations("doctor.myDay");
  const isBreak = entry.type === "break";
  const isReserve = entry.type === "reserve";

  if (isBreak || isReserve || entry.patientId == null) {
    return (
      <div className="shrink-0 text-right">
        {entry.durationMin ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("schedule.durationMin", { n: entry.durationMin })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    );
  }

  // Workflow CTAs (Вызвать / Начать / Завершить) only make sense for
  // today. On a past/future date the row is read-only — show a static
  // status badge so the doctor can't accidentally flip a future visit
  // into IN_PROGRESS while paging through the schedule.
  if (!isToday) {
    if (entry.status === "upcoming") {
      return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          {t("status.planned")}
        </span>
      );
    }
    if (entry.status === "done") {
      return (
        <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          {t("status.alreadyVisited")}
        </span>
      );
    }
    if (entry.status === "no_show") {
      return (
        <span className="inline-flex shrink-0 items-center rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
          {t("status.noShow")}
        </span>
      );
    }
    if (entry.status === "cancelled") {
      return (
        <span className="inline-flex shrink-0 items-center rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive">
          {t("status.cancelled")}
        </span>
      );
    }
    if (entry.status === "in_progress") {
      return (
        <span className="inline-flex shrink-0 items-center rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">
          {t("status.inProgress")}
        </span>
      );
    }
  }

  if (entry.status === "in_progress") {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
          {t("status.inProgress")}
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => onFire("COMPLETED")}
          className="motion-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-success px-3 text-sm font-semibold text-white transition-colors hover:bg-success/90 disabled:opacity-60"
        >
          {isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <CheckCircle2Icon className="size-4" />
          )}
          {t("schedule.finish")}
        </button>
      </div>
    );
  }

  if (entry.status === "done") {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          {t("status.alreadyVisited")}
        </span>
        <RevertButton
          isPending={isPending}
          /* The doctor's primary "oops" recovery — most common case is
             clicking "Завершить" on the wrong row. */
          onClick={() => onFire("IN_PROGRESS", { revert: true })}
          tooltip={t("schedule.revertReopen")}
        />
      </div>
    );
  }

  if (entry.status === "no_show") {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <span className="inline-flex items-center rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
          {t("status.noShow")}
        </span>
        <RevertButton
          isPending={isPending}
          onClick={() => onFire("BOOKED", { revert: true })}
          tooltip={t("schedule.revertToPlanned")}
        />
      </div>
    );
  }

  if (entry.status === "cancelled") {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive">
          {t("status.cancelled")}
        </span>
        <RevertButton
          isPending={isPending}
          onClick={() => onFire("BOOKED", { revert: true })}
          tooltip={t("schedule.revertRestore")}
        />
      </div>
    );
  }

  // upcoming — the 3-step clinic workflow lives here as a per-row CTA:
  //   - !calledAt → «Вызвать» (stamps calledAt + Telegram пациенту)
  //   -  calledAt → «Начать приём» (with a small "Вызван" badge)
  // Only the first upcoming row gets the bold primary style; everything
  // else is outlined (still clickable — handy when the doctor wants to
  // start out-of-order or call someone earlier than the queue suggests).
  if (!entry.calledAt) {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={onCall}
        className={cn(
          "motion-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60",
          isNextUpcoming
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border border-border bg-background text-foreground hover:bg-muted",
        )}
      >
        {isPending ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <MegaphoneIcon className="size-4" />
        )}
        {t("schedule.call")}
      </button>
    );
  }

  // After the call, «Начать приём» is intentionally outline-styled even
  // on the next-upcoming row — visually distinct from the primary «Вызвать»
  // it just replaced, so the doctor doesn't accidentally double-click into
  // IN_PROGRESS while they're waiting on the patient.
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="inline-flex items-center gap-1 rounded-full bg-violet/15 px-2 py-1 text-[11px] font-semibold text-violet">
        <MegaphoneIcon className="size-3" />
        {t("status.called")}
      </span>
      <button
        type="button"
        disabled={isPending}
        onClick={() => onFire("IN_PROGRESS")}
        className="motion-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        {isPending ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <PlayIcon className="size-4" />
        )}
        {t("schedule.startVisit")}
      </button>
    </div>
  );
}

function RevertButton({
  isPending,
  onClick,
  tooltip,
}: {
  isPending: boolean;
  onClick: () => void;
  tooltip: string;
}) {
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={onClick}
      aria-label={tooltip}
      title={tooltip}
      className="motion-press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
    >
      {isPending ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <RotateCcwIcon className="size-3.5" />
      )}
    </button>
  );
}
