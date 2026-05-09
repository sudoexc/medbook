"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { ClockIcon, MoreVerticalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
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

const MAX_VISIBLE_QUEUE = 3;

/**
 * Compact cabinet card per Image #13 feedback.
 *
 *   ┌──────────────────────────────────────┐
 *   │ Кабинет 101  ● Идёт приём        ⋮  │
 *   │ ◯ Эргашев Б. С.                      │
 *   │   Невролог                           │
 *   │ В ОЧЕРЕДИ (3)              🕐 25 мин │
 *   │ 1. Ali Karimov           — 14:30     │
 *   │ 2. Dilshod Aliyev        — 14:50     │
 *   │ 3. Madina Yusupova       — 15:10     │
 *   │ [   Вызвать следующего           ]   │
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
  const qc = useQueryClient();
  const [pending, setPending] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  const current =
    appointments.find((a) => a.queueStatus === "IN_PROGRESS") ?? null;
  const waiting = appointments.filter((a) => a.queueStatus === "WAITING");
  const booked = appointments.filter((a) => a.queueStatus === "BOOKED");
  const upcoming = [...waiting, ...booked].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const cabinetNumber =
    (current ?? upcoming[0])?.cabinet?.number ??
    appointments[0]?.cabinet?.number ??
    null;

  const state: CabinetState = current
    ? "in_session"
    : upcoming.length > 0
      ? "awaiting"
      : "empty";

  const doctorSpec =
    locale === "uz" ? doctor.specializationUz : doctor.specializationRu;
  const doctorName = locale === "uz" ? doctor.nameUz : doctor.nameRu;

  const waitMin = computeWaitMinutes(state, current, upcoming[0] ?? null);

  const invalidate = () => {
    const opts = { refetchType: "active" } as const;
    qc.invalidateQueries({ queryKey: ["reception"], ...opts });
    qc.invalidateQueries({ queryKey: ["appointments", "list"], ...opts });
    qc.invalidateQueries({ queryKey: ["calendar", "appointments"], ...opts });
    qc.invalidateQueries({ queryKey: ["crm", "shell-summary"], ...opts });
  };

  const advanceQueue = async () => {
    // If there's a current in-session patient, complete them first.
    if (current) {
      setPending(true);
      try {
        const res = await fetch(
          `/api/crm/appointments/${current.id}/queue-status`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queueStatus: "COMPLETED" }),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        setPending(false);
        toast.error((err as Error).message);
        return;
      }
    }
    const candidate = waiting[0] ?? booked[0];
    if (!candidate) {
      setPending(false);
      invalidate();
      return;
    }
    setPending(true);
    try {
      const res = await fetch(
        `/api/crm/appointments/${candidate.id}/queue-status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queueStatus: "IN_PROGRESS" }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const visible = upcoming.slice(0, MAX_VISIBLE_QUEUE);

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border bg-card p-4",
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

      <div className="flex items-center gap-2.5">
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
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("inQueueCount", { count: upcoming.length })}
          </span>
          {waitMin !== null ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground tabular-nums">
              <ClockIcon className="size-3" />
              {t("waitMin", { min: waitMin })}
            </span>
          ) : null}
        </div>

        {visible.length > 0 ? (
          <ul className="space-y-1">
            {visible.map((a, i) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onRowClick(a.id)}
                  className="group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted/60"
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
        ) : (
          <p className="py-1 text-center text-xs text-muted-foreground">
            {t("queueEmpty")}
          </p>
        )}
      </div>

      <div className="mt-auto pt-1">
        {state === "empty" && upcoming.length === 0 ? (
          <Button
            variant="outline"
            className="w-full border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
            onClick={() => onAddAppointment?.(doctor.id)}
            disabled={!onAddAppointment}
          >
            <PlusIcon className="size-4" />
            {t("addAppointment")}
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={pending || (upcoming.length === 0 && !current)}
            onClick={advanceQueue}
          >
            {t("callNext")}
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
  const tone =
    state === "in_session"
      ? "bg-success/15 text-success"
      : state === "awaiting"
        ? "bg-warning/15 text-[color:var(--warning-foreground)]"
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
