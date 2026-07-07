"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRightIcon, ClockIcon, MoreVerticalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { splitReceptionLanes } from "@/lib/queue-ordering";
import { Button } from "@/components/ui/button";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import type { DoctorRef } from "../_hooks/use-reception-live";

export interface DoctorQueueCardProps {
  /** Positional index in the cabinets grid (1-based) — fallback for cabinet number. */
  index: number;
  doctor: DoctorRef;
  appointments: AppointmentRow[];
  onRowClick: (appointmentId: string) => void;
  onAddAppointment?: (doctorId: string) => void;
  className?: string;
}

type CabinetState = "in_session" | "awaiting" | "empty";

/** When the live queue exceeds this many rows, switch to a scrollable list. */
const SCROLL_AFTER = 4;

/** Bookings shown beyond this cap collapse into a "+N" line. */
const MAX_BOOKINGS = 3;

/**
 * Compact cabinet card per Image #13 feedback, two-lanes layout
 * (docs/TZ-two-lanes.md):
 *
 *   ┌──────────────────────────────────────┐
 *   │ Кабинет 101  ● Идёт приём        ⋮  │
 *   │ ◯ Эргашев Б. С.                      │
 *   │   Невролог                           │
 *   │ В ОЧЕРЕДИ (2)              🕐 25 мин │
 *   │ 1. Ali Karimov           — 14:30     │
 *   │ 2. Dilshod Aliyev        — 14:50     │
 *   │ ЗАПИСИ                               │
 *   │ 15:10 Madina Yusupova  [Начать]      │
 *   │ [   Вызвать из очереди           ]   │
 *   └──────────────────────────────────────┘
 */
export function DoctorQueueCard({
  index,
  doctor,
  appointments,
  onRowClick,
  onAddAppointment,
  className,
}: DoctorQueueCardProps) {
  const locale = useLocale();
  const t = useTranslations("reception.doctorQueue");
  const tToast = useTranslations("crmToasts.appointment");
  const qc = useQueryClient();
  const [pending, setPending] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  // Bumped on successful queue advance to retrigger the `motion-success-pop`
  // animation on the action button via a re-mount key. CSS animations don't
  // replay without a class toggle or re-mount, so we use the cheapest path.
  const [popKey, setPopKey] = React.useState(0);

  const current =
    appointments.find((a) => a.queueStatus === "IN_PROGRESS") ?? null;
  // Shared reception split: live = waiting walk-ins in FIFO order (slot time
  // never orders them), bookings keep the calendar axis (two-lanes TZ I2).
  const { live, booked: bookings } = splitReceptionLanes(appointments);

  const cabinetNumber =
    (current ?? live[0] ?? bookings[0])?.cabinet?.number ??
    appointments[0]?.cabinet?.number ??
    null;

  const state: CabinetState = current
    ? "in_session"
    : live.length + bookings.length > 0
      ? "awaiting"
      : "empty";

  const doctorSpec =
    locale === "uz" ? doctor.specializationUz : doctor.specializationRu;
  const doctorName = locale === "uz" ? doctor.nameUz : doctor.nameRu;

  const waitMin = computeWaitMinutes(
    state,
    current,
    live[0] ?? bookings[0] ?? null,
  );

  const invalidate = () => {
    const opts = { refetchType: "active" } as const;
    qc.invalidateQueries({ queryKey: ["reception"], ...opts });
    qc.invalidateQueries({ queryKey: ["appointments", "list"], ...opts });
    qc.invalidateQueries({ queryKey: ["calendar", "appointments"], ...opts });
    qc.invalidateQueries({ queryKey: ["crm", "shell-summary"], ...opts });
  };

  // Parse the API error envelope (`{ error, reason }`, see server/http.ts)
  // and toast a localized message — raw `HTTP ${status}` codes never reach
  // the receptionist.
  const toastStartError = async (res: Response) => {
    let reason = "";
    try {
      const j = (await res.json()) as { error?: string; reason?: string };
      reason = j.reason ?? "";
    } catch {
      // body wasn't JSON — fall through to the generic message.
    }
    toast.error(
      reason === "another_visit_in_progress"
        ? tToast("startConflict")
        : t("startFailed"),
    );
  };

  // Shared "complete current, then start" transition — used by the live-lane
  // call button and each booking's «Начать запись». Completing the current
  // patient must succeed before the candidate goes IN_PROGRESS (one per
  // doctor), so a failure aborts without touching the candidate.
  const startVisit = async (candidate: AppointmentRow) => {
    // Switching patients implicitly completes the current visit — make the
    // receptionist confirm before we close it behind the doctor's back.
    if (current && !window.confirm(t("switchConfirm"))) return;
    setPending(true);
    try {
      if (current) {
        const res = await fetch(
          `/api/crm/appointments/${current.id}/queue-status`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queueStatus: "COMPLETED" }),
          },
        );
        if (!res.ok) {
          await toastStartError(res);
          return;
        }
      }
      const res = await fetch(
        `/api/crm/appointments/${candidate.id}/queue-status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queueStatus: "IN_PROGRESS" }),
        },
      );
      if (!res.ok) {
        await toastStartError(res);
        return;
      }
      invalidate();
      setPopKey((k) => k + 1);
    } catch {
      // Network-level failure (fetch threw before a response landed).
      toast.error(t("startFailed"));
    } finally {
      setPending(false);
    }
  };

  // «Вызвать из очереди» promotes only the live-lane head — bookings never
  // auto-advance, the receptionist starts them per row.
  const advanceQueue = () => {
    const head = live[0];
    if (head) void startVisit(head);
  };

  const scrollable = live.length > SCROLL_AFTER;

  return (
    <article
      className={cn(
        "motion-rise-in motion-hover-lift flex flex-col gap-3 rounded-2xl border border-border bg-card p-4",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {t("cabinet")} {cabinetNumber ?? index}
          </h3>
          <StatusPill state={state} t={t} />
        </div>
        {onAddAppointment ? (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("menuLabel")}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreVerticalIcon className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onAddAppointment(doctor.id);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                <PlusIcon className="size-4" />
                {t("addAppointment")}
              </button>
            </PopoverContent>
          </Popover>
        ) : null}
      </header>

      <Link
        href={`/crm/calendar?doctors=${doctor.id}`}
        aria-label={t("openDoctor", { name: doctorName })}
        className={cn(
          "group/doctor -mx-1 flex items-center gap-2.5 rounded-lg px-1 py-1",
          "transition-colors hover:bg-muted/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <AvatarWithStatus
          name={doctorName}
          src={doctor.photoUrl}
          size="sm"
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {doctorName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {doctorSpec ?? t("specialist")}
          </p>
        </div>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground/40 transition-[transform,color] duration-150 group-hover/doctor:translate-x-0.5 group-hover/doctor:text-foreground"
        />
      </Link>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("inQueueCount", { count: live.length })}
          </span>
          {waitMin !== null ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground tabular-nums">
              <ClockIcon className="size-3" />
              {t("waitMin", { min: waitMin })}
            </span>
          ) : null}
        </div>

        {live.length === 0 && bookings.length === 0 ? (
          <p className="py-1 text-center text-xs text-muted-foreground">
            {t("queueEmpty")}
          </p>
        ) : (
          <>
            {live.length > 0 ? (
              <ul
                className={cn(
                  "space-y-1",
                  scrollable &&
                    "max-h-[136px] overflow-y-auto pr-1 [scrollbar-width:thin]",
                )}
              >
                {live.map((a, i) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => onRowClick(a.id)}
                      className="motion-press group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                        {i + 1}.
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {a.patient.fullName}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        — {formatTime(new Date(a.date), locale)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {bookings.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("sectionBooked")}
                </span>
                <ul className="space-y-1">
                  {bookings.slice(0, MAX_BOOKINGS).map((a) => (
                    <li key={a.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onRowClick(a.id)}
                        className="motion-press group flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/60"
                      >
                        <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                          {formatTime(new Date(a.date), locale)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {a.patient.fullName}
                        </span>
                        {a.queueStatus === "WAITING" ? (
                          <span className="inline-flex shrink-0 items-center rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-text">
                            {t("arrivedBadge")}
                          </span>
                        ) : null}
                      </button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 shrink-0 px-2 text-[11px]"
                        disabled={pending}
                        onClick={() => void startVisit(a)}
                      >
                        {t("startBooking")}
                      </Button>
                    </li>
                  ))}
                </ul>
                {bookings.length > MAX_BOOKINGS ? (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {t("backlogCount", {
                      count: bookings.length - MAX_BOOKINGS,
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-auto pt-1">
        {state === "empty" ? (
          <Button
            variant="outline"
            className="motion-press w-full border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
            onClick={() => onAddAppointment?.(doctor.id)}
            disabled={!onAddAppointment}
          >
            <PlusIcon className="size-4" />
            {t("addAppointment")}
          </Button>
        ) : (
          <Button
            key={popKey}
            className={cn(
              "motion-press w-full",
              popKey > 0 && "motion-success-pop",
            )}
            disabled={pending || live.length === 0}
            onClick={advanceQueue}
          >
            {t("callNextLive")}
          </Button>
        )}
      </div>
    </article>
  );
}

function StatusPill({
  state,
  t,
}: {
  state: CabinetState;
  t: ReturnType<typeof useTranslations>;
}) {
  const label =
    state === "in_session"
      ? t("pillInSession")
      : state === "awaiting"
        ? t("pillAwaiting")
        : t("pillFree");
  // `--warning-foreground` is white (designed for solid `bg-warning`). On a
  // light tint like `bg-warning/15` it disappears — `--warning-text` is the
  // readable amber tuned for tinted surfaces (~5.5:1 on the tint over white).
  const tone =
    state === "in_session"
      ? "bg-success/15 text-success"
      : state === "awaiting"
        ? "bg-warning/20 text-warning-text dark:bg-warning/25"
        : "bg-muted text-muted-foreground";
  const dot =
    state === "in_session"
      ? "bg-success"
      : state === "awaiting"
        ? "bg-warning"
        : "bg-muted-foreground/60";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}

function computeWaitMinutes(
  state: CabinetState,
  current: AppointmentRow | null,
  next: AppointmentRow | null,
): number | null {
  const now = Date.now();
  if (state === "in_session" && current) {
    if (current.startedAt) {
      const started = new Date(current.startedAt).getTime();
      const planned = Math.max(5, current.durationMin || 30);
      const elapsed = Math.max(0, Math.round((now - started) / 60000));
      const left = Math.max(0, planned - elapsed);
      return left;
    }
    return current.durationMin || null;
  }
  if (next) {
    const at = new Date(next.date).getTime();
    const diff = Math.round((at - now) / 60000);
    if (diff > 0) return diff;
    return 0;
  }
  return null;
}

function formatTime(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
