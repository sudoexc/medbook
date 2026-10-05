"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClockIcon, CheckIcon, TicketPlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { intlLocale } from "@/lib/format";
import { splitMinutes, type DoctorDaySummary } from "@/lib/reception-tablet/doctor-day";

import type { TabletDoctor } from "../_hooks/use-tablet-data";
import { Caption, TicketLetter, TOUCH, TouchButton } from "./tablet-ui";

/** «≈ 25 мин», «≈ 1 ч 10 мин», «Сразу». */
export function useWaitText() {
  const t = useTranslations("receptionTablet.tile");
  return React.useCallback(
    (min: number) => {
      if (min <= 0) return t("waitNone");
      const { hours, minutes } = splitMinutes(min);
      return hours > 0 ? t("waitHours", { hours, min: minutes }) : t("waitMinutes", { min: minutes });
    },
    [t],
  );
}

export function doctorName(d: Pick<TabletDoctor, "nameRu" | "nameUz">, locale: string): string {
  return locale === "uz" ? d.nameUz || d.nameRu : d.nameRu || d.nameUz;
}

function StatusPill({ summary }: { summary: DoctorDaySummary | undefined }) {
  const t = useTranslations("receptionTablet.tile");
  const status = summary?.status ?? "off";
  const tone =
    status === "busy"
      ? "bg-success/15 text-success"
      : status === "free"
        ? "bg-primary/10 text-primary"
        : "bg-muted text-muted-foreground";
  const dot =
    status === "busy" ? "bg-success" : status === "free" ? "bg-primary" : "bg-muted-foreground/60";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[15px] font-semibold",
        tone,
      )}
    >
      <span className={cn("size-2 rounded-full", dot)} aria-hidden />
      {status === "busy" ? t("statusBusy") : status === "free" ? t("statusFree") : t("statusOff")}
    </span>
  );
}

/** Name, specialization and cabinet: the head of every doctor tile. */
function TileHead({
  doctor,
  summary,
}: {
  doctor: TabletDoctor;
  summary: DoctorDaySummary | undefined;
}) {
  const locale = useLocale();
  const t = useTranslations("receptionTablet.tile");
  const spec = locale === "uz" ? doctor.specializationUz : doctor.specializationRu;
  return (
    <div className="flex items-start gap-4">
      <TicketLetter letter={doctor.ticketPrefix} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xl font-semibold leading-tight text-foreground">
          {doctorName(doctor, locale)}
        </p>
        <p className="mt-1 truncate text-[15px] text-muted-foreground">
          {[spec, doctor.cabinet ? t("cabinet", { number: doctor.cabinet.number }) : t("noCabinet")]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <StatusPill summary={summary} />
    </div>
  );
}

/** Waiting now, who is inside, rough wait: the three numbers that decide. */
function TileStats({ summary }: { summary: DoctorDaySummary | undefined }) {
  const t = useTranslations("receptionTablet.tile");
  const waitText = useWaitText();
  const waiting = summary?.waiting ?? 0;
  const waitMin = summary?.waitMin ?? 0;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-5 border-y border-border py-3">
      <div className="flex flex-col gap-0.5">
        <dt>
          <Caption>{t("waiting")}</Caption>
        </dt>
        <dd className="text-3xl font-bold tabular-nums leading-none text-foreground">{waiting}</dd>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt>
          <Caption>{t("inside")}</Caption>
        </dt>
        <dd className="truncate pt-1 text-[17px] font-medium text-foreground">
          {summary?.inside ? summary.inside.patientName : (
            <span className="text-muted-foreground">{t("nobodyInside")}</span>
          )}
        </dd>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <dt>
          <Caption>{t("wait")}</Caption>
        </dt>
        <dd
          className={cn(
            "pt-1 text-[17px] font-semibold tabular-nums",
            waitMin >= 60 ? "text-warning-text" : "text-foreground",
          )}
        >
          {waitText(waitMin)}
        </dd>
      </div>
    </dl>
  );
}

/** Home tile: the doctor's state and the two ways to send a patient to him. */
export function DoctorTile({
  doctor,
  summary,
  onQueue,
  onBook,
  disabled,
}: {
  doctor: TabletDoctor;
  summary: DoctorDaySummary | undefined;
  onQueue: () => void;
  onBook: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("receptionTablet.tile");
  const offDuty = summary ? !summary.onDuty : true;
  return (
    <article
      className={cn(
        "motion-rise-in flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        offDuty && "bg-card/70",
      )}
    >
      <TileHead doctor={doctor} summary={summary} />
      <TileStats summary={summary} />
      {summary?.nextFree || summary?.scheduled ? (
        <p className="-mt-1 text-[15px] text-muted-foreground">
          {summary.nextFree ? t("nextFree", { time: summary.nextFree }) : t("noFreeToday")}
        </p>
      ) : null}
      <div className="mt-auto grid grid-cols-2 gap-3">
        <TouchButton tone="primary" onClick={onQueue} disabled={disabled}>
          <TicketPlusIcon />
          {t("toQueue")}
        </TouchButton>
        <TouchButton tone="outline" onClick={onBook} disabled={disabled}>
          <CalendarClockIcon />
          {t("toBook")}
        </TouchButton>
      </div>
    </article>
  );
}

/** «ср, 7 окт.»: a day of the booking window, as the day strip names it. */
function shortDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale === "uz" ? "uz" : "ru"), {
    timeZone: "Asia/Tashkent",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${day}T12:00:00+05:00`));
}

/**
 * Today at a glance for a booking: free from when, full, or not working
 * today and the first day he does. The step lists doctors who work later
 * in the window too, so «сегодня» must be said, not assumed.
 */
function TodayAvailability({
  summary,
  today,
}: {
  summary: DoctorDaySummary | undefined;
  today: string;
}) {
  const t = useTranslations("receptionTablet.tile");
  const locale = useLocale();
  if (!summary) return null;
  // Working today (by the schedule, or the open day of a doctor without
  // one) but no slot left: full. Not working today: when he is next.
  const worksToday = summary.scheduled || summary.nextWorkDay === today;
  const text = summary.nextFree
    ? t("todayFree", { time: summary.nextFree })
    : worksToday
      ? t("noFreeToday")
      : summary.nextWorkDay
        ? t("todayOffNext", { day: shortDay(summary.nextWorkDay, locale) })
        : t("todayOff");
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-[17px] font-medium",
        summary.nextFree ? "text-primary" : "text-muted-foreground",
      )}
    >
      <CalendarClockIcon className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

/** Doctor step tile: the whole card is one big target. */
export function DoctorPickTile({
  doctor,
  summary,
  selected,
  bookingToday = null,
  onPick,
}: {
  doctor: TabletDoctor;
  summary: DoctorDaySummary | undefined;
  selected: boolean;
  /** «Записать на время» (today's Tashkent day): say how today stands for him. */
  bookingToday?: string | null;
  onPick: () => void;
}) {
  const t = useTranslations("receptionTablet.tile");
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        TOUCH,
        "motion-press relative flex flex-col gap-4 rounded-3xl border bg-card p-5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary ring-2 ring-primary"
          : "border-border active:bg-muted/50",
      )}
    >
      <TileHead doctor={doctor} summary={summary} />
      <TileStats summary={summary} />
      {bookingToday ? <TodayAvailability summary={summary} today={bookingToday} /> : null}
      {selected ? (
        <span className="absolute -right-2 -top-2 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[15px] font-semibold text-primary-foreground shadow">
          <CheckIcon className="size-4" aria-hidden />
          {t("selected")}
        </span>
      ) : null}
    </button>
  );
}
