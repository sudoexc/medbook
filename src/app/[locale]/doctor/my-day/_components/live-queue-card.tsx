"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2Icon, MegaphoneIcon, UsersIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

import {
  useDoctorToday,
  type DoctorToday,
  type LiveQueueEntry,
} from "../_hooks/use-doctor-today";
import { useMinuteClock } from "./upcoming-patients";
import { todayDateKey } from "./current-patient-card";
import { useAppointmentStatusMutation } from "../_hooks/use-appointment-status-mutation";

/** YYYY-MM-DD for today's local date — matches the schedule cache key. */


/**
 * The LIVE lane of the two-lanes model (docs/TZ-two-lanes.md): walk-ins
 * only, FIFO order straight from the server projection. Sits next to the
 * schedule card so the doctor explicitly picks whom to serve — «Вызвать»
 * here vs «Начать» on a booking — with no automatic interleaving.
 *
 * «Вызвать» reuses the same call mutation as the schedule/current cards
 * (PATCH ?call=true → calledAt stamped, patient Telegram fired, straight
 * to IN_PROGRESS), including the another-visit-in-progress error toast.
 */
export function LiveQueueCard() {
  const t = useTranslations("doctor.myDay.liveQueue");
  const dateKey = React.useMemo(() => todayDateKey(), []);
  const mutation = useAppointmentStatusMutation(dateKey);

  const { data, isLoading } = useDoctorToday<LiveQueueEntry[]>(
    (d: DoctorToday) => d.liveQueue,
  );
  const queue = data ?? [];

  const nowMs = useMinuteClock();
  // The mutation object is shared across rows — pin the spinner to the row
  // actually being called while every button disables during the flight.
  const pendingId = mutation.isPending
    ? mutation.variables?.appointmentId
    : undefined;

  const callIn = (entry: LiveQueueEntry) =>
    mutation.mutate({
      appointmentId: entry.appointmentId,
      // toStatus is ignored by the call branch — sentinel only.
      toStatus: "WAITING",
      call: true,
    });

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          {t("title")}
        </div>
        {queue.length > 0 ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
            {queue.length}
          </span>
        ) : null}
      </header>

      <ul className="flex-1 divide-y divide-border/60 px-2 pb-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-7 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-9 w-24 shrink-0 rounded-lg" />
            </li>
          ))
        ) : queue.length === 0 ? (
          <li className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UsersIcon className="size-5" />
            </div>
            <div className="text-sm text-muted-foreground">{t("empty")}</div>
          </li>
        ) : (
          queue.map((entry) => {
            const waitingMin = entry.queuedAt
              ? Math.max(
                  0,
                  Math.floor(
                    (nowMs - new Date(entry.queuedAt).getTime()) / 60_000,
                  ),
                )
              : null;
            const rowPending = pendingId === entry.appointmentId;

            return (
              <li
                key={entry.appointmentId}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
              >
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                  {entry.position}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {entry.patientFullName}
                    </span>
                    <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
                      {t("ticket")} {entry.ticketNumber}
                    </span>
                  </div>
                  {waitingMin !== null ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                      {t("waitingFor", { min: waitingMin })}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => callIn(entry)}
                  className="motion-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {rowPending ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <MegaphoneIcon className="size-4" />
                  )}
                  {t("call")}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
