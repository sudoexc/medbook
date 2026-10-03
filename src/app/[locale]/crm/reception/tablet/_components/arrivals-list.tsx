"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon, UserCheckIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { lateMinutes, type TabletApptRow } from "@/lib/reception-tablet/doctor-day";

import { useSetQueueStatus } from "../../../appointments/_hooks/use-appointment";
import type { TabletDoctor } from "../_hooks/use-tablet-data";
import { doctorName } from "./doctor-tile";
import { TouchButton } from "./tablet-ui";

/**
 * «Пришли по записи»: today's bookings with one big «Пришёл» each. The
 * check-in is the appointment card's own mutation (`useSetQueueStatus`, the
 * queue-status route): today only, the sweep's no-show exception, the
 * phone-owner rules of the card, and its error toasts in words.
 */
export function ArrivalsList({
  rows,
  doctors,
  now,
  online,
  emptyText,
}: {
  rows: TabletApptRow[];
  doctors: ReadonlyMap<string, TabletDoctor>;
  now: Date;
  online: boolean;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border bg-card/40 px-6 py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <UserCheckIcon className="size-7" aria-hidden />
        </span>
        <p className="text-[17px] text-muted-foreground">{emptyText}</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <ArrivalRow
          key={r.id}
          row={r}
          doctor={doctors.get(r.doctor.id)}
          now={now}
          online={online}
        />
      ))}
    </ul>
  );
}

function ArrivalRow({
  row,
  doctor,
  now,
  online,
}: {
  row: TabletApptRow;
  doctor: TabletDoctor | undefined;
  now: Date;
  online: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("receptionTablet.arrival");
  const mutation = useSetQueueStatus(row.id);
  const [done, setDone] = React.useState(false);
  const late = row.queueStatus === "NO_SHOW" ? 0 : lateMinutes(row, now);
  const time = row.time ?? formatDate(row.date, locale === "uz" ? "uz" : "ru", "time");

  const arrive = () => {
    if (mutation.isPending || done) return;
    mutation.mutate("WAITING", {
      onSuccess: () => {
        setDone(true);
        toast.success(t("toast", { name: row.patient.fullName }));
      },
    });
  };

  const where = doctor
    ? doctor.cabinet
      ? t("where", { doctor: doctorName(doctor, locale), cabinet: doctor.cabinet.number })
      : doctorName(doctor, locale)
    : "";

  return (
    <li
      className={cn(
        "flex items-center gap-4 rounded-2xl border bg-card px-4 py-3 transition-opacity",
        late > 0 ? "border-warning/50" : "border-border",
        done && "opacity-60",
      )}
    >
      <span className="w-[4.5rem] shrink-0 text-[22px] font-bold tabular-nums text-foreground">
        {time}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold text-foreground">{row.patient.fullName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted-foreground">
          {where ? <span className="truncate">{where}</span> : null}
          {row.queueStatus === "NO_SHOW" ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[13px] font-semibold">
              {t("missed")}
            </span>
          ) : late > 0 ? (
            <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[13px] font-semibold text-warning-text">
              {t("late", { min: late })}
            </span>
          ) : (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[13px] font-semibold",
                row.queueStatus === "CONFIRMED"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {row.queueStatus === "CONFIRMED" ? t("confirmed") : t("unconfirmed")}
            </span>
          )}
        </p>
      </div>
      <TouchButton
        tone={done ? "outline" : "success"}
        className="min-w-[9.5rem]"
        onClick={arrive}
        disabled={!online || mutation.isPending || done}
        aria-label={`${t("arrived")}: ${row.patient.fullName}`}
      >
        {done ? <CheckIcon /> : <UserCheckIcon />}
        {done ? t("done") : mutation.isPending ? t("marking") : t("arrived")}
      </TouchButton>
    </li>
  );
}
