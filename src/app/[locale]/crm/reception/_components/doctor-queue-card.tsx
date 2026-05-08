"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArmchairIcon,
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  HourglassIcon,
  Loader2Icon,
  PlayIcon,
  UserCheckIcon,
  UserXIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import type { DoctorRef } from "../_hooks/use-reception-live";
import { useCurrentRole } from "../../patients/[id]/_hooks/use-current-role";
import {
  getQuickActions,
  type QuickAction,
} from "@/lib/appointments/lifecycle";
import type { AppointmentStatus } from "@/lib/appointment-transitions";

export interface DoctorQueueCardProps {
  /** Positional index in the cabinets grid (1-based) — shown in the blue circle. */
  index: number;
  doctor: DoctorRef;
  appointments: AppointmentRow[];
  onRowClick: (appointmentId: string) => void;
  onAddAppointment?: (doctorId: string) => void;
  className?: string;
}

type CabinetState = "in_session" | "awaiting" | "empty";

/**
 * Cabinet card per docs/1-Ресепшн (2).png.
 *
 *   ┌──────────────────────────────────────┐
 *   │ ● Каб. 1                       [①]   │
 *   │   Невролог                           │
 *   ├──────────────────────────────────────┤
 *   │  ┌──────────────────────────────┐    │
 *   │  │ ● НА ПРИЁМЕ                  │    │
 *   │  │ Muhammad                     │    │
 *   │  │ 28 лет    ⓘ Осталось 6 мин  │    │
 *   │  │ ▓▓▓▓▓░░░░                    │    │
 *   │  └──────────────────────────────┘    │
 *   │                                      │
 *   │ ОЧЕРЕДЬ (2)                          │
 *   │ 1 Aliyev Sanjar         0:20         │
 *   │ 2 Karimova Malika       0:40         │
 *   │                                      │
 *   │ [  Вызвать следующего  ]             │
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

  const role = useCurrentRole();

  const current = appointments.find((a) => a.queueStatus === "IN_PROGRESS") ?? null;
  const waiting = appointments.filter((a) => a.queueStatus === "WAITING");
  const booked = appointments.filter((a) => a.queueStatus === "BOOKED");
  const upcoming = [...waiting, ...booked].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // Tracks which row currently has an in-flight quick-status mutation.
  // Disabling the icons during PATCH prevents double-click → 409.
  const [pendingId, setPendingId] = React.useState<string | null>(null);

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

  const invalidate = () => {
    const opts = { refetchType: "active" } as const;
    qc.invalidateQueries({ queryKey: ["reception"], ...opts });
    qc.invalidateQueries({ queryKey: ["appointments", "list"], ...opts });
  };

  const setQueueStatus = async (
    appointmentId: string,
    next: AppointmentStatus,
    successMessage: string,
  ) => {
    setPendingId(appointmentId);
    try {
      const res = await fetch(
        `/api/crm/appointments/${appointmentId}/queue-status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queueStatus: next }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          reason?: string;
        } | null;
        throw new Error(j?.reason ?? `HTTP ${res.status}`);
      }
      invalidate();
      const opts = { refetchType: "active" } as const;
      qc.invalidateQueries({ queryKey: ["calendar", "appointments"], ...opts });
      qc.invalidateQueries({ queryKey: ["crm", "shell-summary"], ...opts });
      toast.success(successMessage);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPendingId(null);
    }
  };

  const callNext = async () => {
    const candidate = waiting[0] ?? booked[0];
    if (!candidate) {
      if (onAddAppointment) onAddAppointment(doctor.id);
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

  return (
    <article
      className={cn(
        "flex min-h-[320px] flex-col rounded-2xl border border-border bg-card p-4",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: doctor.color ?? "#2b6cff" }}
              aria-hidden
            />
            <h3 className="truncate text-[15px] font-bold text-foreground">
              {t("cabinet")} {cabinetNumber ?? index}
            </h3>
          </div>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-foreground">
            {doctorName}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            {doctorSpec ?? t("specialist")}
          </p>
        </div>
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground tabular-nums">
          {index}
        </span>
      </header>

      <div className="mt-3 flex-1">
        {state === "in_session" && current ? (
          <InSessionBlock
            appointment={current}
            onClick={() => onRowClick(current.id)}
            onComplete={async () => {
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
                invalidate();
                const opts = { refetchType: "active" } as const;
                qc.invalidateQueries({ queryKey: ["calendar", "appointments"], ...opts });
                qc.invalidateQueries({ queryKey: ["crm", "shell-summary"], ...opts });
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setPending(false);
              }
            }}
            pending={pending}
          />
        ) : state === "awaiting" ? (
          <AwaitingBlock nextTime={upcoming[0] ? new Date(upcoming[0].date) : null} />
        ) : (
          <EmptyBlock />
        )}

      </div>

      {upcoming.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>{t("queueCount", { count: upcoming.length })}</span>
          </div>
          <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
            {upcoming.map((a, i) => (
              <li
                key={a.id}
                className="group flex items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-muted/60"
              >
                <button
                  type="button"
                  onClick={() => onRowClick(a.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {a.patient.fullName}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                    {formatQueueTime(new Date(a.date), locale)}
                  </span>
                </button>
                <QuickStatusRow
                  appointment={a}
                  role={role}
                  pending={pendingId === a.id}
                  onChange={(next, successKey) =>
                    setQueueStatus(a.id, next, successKey)
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ) : state === "in_session" ? null : (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("queueCount", { count: 0 })}
          </div>
          <p className="text-center text-sm text-muted-foreground">
            {t("queueEmpty")}
          </p>
        </div>
      )}

      <div className="mt-4">
        {state === "empty" ? (
          <Button
            variant="outline"
            className="w-full border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
            onClick={() => onAddAppointment?.(doctor.id)}
          >
            {t("addAppointment")}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            disabled={pending || upcoming.length === 0}
            onClick={callNext}
          >
            {t("callNext")}
          </Button>
        )}
      </div>
    </article>
  );
}

function InSessionBlock({
  appointment,
  onClick,
  onComplete,
  pending,
}: {
  appointment: AppointmentRow;
  onClick: () => void;
  onComplete: () => void;
  pending: boolean;
}) {
  const t = useTranslations("reception.doctorQueue");
  const locale = useLocale();
  const [nowMs] = React.useState(() => Date.now());
  const remaining = React.useMemo(() => {
    if (!appointment.startedAt) {
      return {
        label: t("minPlan", { min: appointment.durationMin }),
        pct: 10,
      };
    }
    const startedMs = new Date(appointment.startedAt).getTime();
    const planned = Math.max(5, appointment.durationMin || 30);
    const elapsed = Math.max(0, Math.round((nowMs - startedMs) / 60000));
    const left = Math.max(0, planned - elapsed);
    const pct = Math.min(100, Math.round((elapsed / planned) * 100));
    return { label: t("remaining", { min: left }), pct };
  }, [appointment, nowMs, t]);

  const serviceName =
    (locale === "uz"
      ? appointment.primaryService?.nameUz
      : appointment.primaryService?.nameRu) ?? t("fallbackService");

  return (
    <div className="rounded-xl bg-success-soft p-3">
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left transition-opacity hover:opacity-90"
      >
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          <span className="text-[10px] font-bold uppercase tracking-wider text-success">
            {t("current")}
          </span>
        </div>
        <p className="mt-2 truncate text-lg font-bold text-foreground">
          {appointment.patient.fullName}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">{serviceName}</span>
          <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-success">
            <ClockIcon className="size-3" />
            {remaining.label}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-success to-success/80 transition-all"
            style={{ width: `${remaining.pct}%` }}
          />
        </div>
      </button>
      <button
        type="button"
        onClick={onComplete}
        disabled={pending}
        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md bg-success px-2 py-1.5 text-[11px] font-semibold text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-50"
      >
        <CheckIcon className="size-3.5" />
        {t("complete")}
      </button>
    </div>
  );
}

function AwaitingBlock({ nextTime }: { nextTime: Date | null }) {
  const t = useTranslations("reception.doctorQueue");
  const locale = useLocale();
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-center">
      <div className="flex items-center justify-center gap-1.5">
        <HourglassIcon className="size-3.5 text-warning" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-warning">
          {t("awaitingPatient")}
        </span>
      </div>
      <div className="mt-4 flex justify-center">
        <ArmchairIcon className="size-10 text-muted-foreground/60" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{t("statusFree")}</p>
      {nextTime ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("nearestTime")}{" "}
          <span className="font-bold text-foreground tabular-nums">
            {formatTime(nextTime, locale)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function EmptyBlock() {
  const t = useTranslations("reception.doctorQueue");
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-center">
      <div className="flex items-center justify-center gap-1.5">
        <HourglassIcon className="size-3.5 text-warning" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-warning">
          {t("awaitingPatient")}
        </span>
      </div>
      <div className="mt-4 flex justify-center">
        <ArmchairIcon className="size-10 text-muted-foreground/60" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{t("statusFree")}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t("noPatients")}
      </p>
    </div>
  );
}

/**
 * Compact icon row that lets the receptionist advance an appointment's
 * status without opening the drawer. Renders only icons for transitions
 * that are both legal (`canTransition`) and time-appropriate (`NO_SHOW`
 * never shows up before the slot start). NO_SHOW is wrapped in a
 * confirmation popover to prevent fat-finger clicks; forward transitions
 * fire on a single click — the existing PATCH handler is the source of
 * truth and any 409 surfaces through the toast.
 */
function QuickStatusRow({
  appointment,
  role,
  pending,
  onChange,
}: {
  appointment: AppointmentRow;
  role: ReturnType<typeof useCurrentRole>;
  pending: boolean;
  onChange: (next: AppointmentStatus, successMessage: string) => void;
}) {
  const t = useTranslations("reception.quickStatus");
  const apptDate = React.useMemo(
    () => new Date(appointment.date),
    [appointment.date],
  );
  const actions = React.useMemo(
    () =>
      getQuickActions(
        appointment.status as AppointmentStatus,
        role,
        apptDate,
      ),
    [appointment.status, role, apptDate],
  );

  if (actions.length === 0) return null;

  return (
    <div className="ml-1 flex shrink-0 items-center gap-0.5">
      {actions.map((action) =>
        action.confirm ? (
          <NoShowButton
            key={action.kind}
            pending={pending}
            onConfirm={() =>
              onChange(action.to, t("toast.noShow" as never))
            }
            label={t("noShow")}
            confirmTitle={t("noShowConfirm")}
            confirmYes={t("noShowYes")}
            confirmNo={t("noShowNo")}
          />
        ) : (
          <QuickIconButton
            key={action.kind}
            action={action}
            pending={pending}
            onClick={() =>
              onChange(
                action.to,
                t(toastKeyFor(action.kind) as never),
              )
            }
            label={t(labelKeyFor(action.kind) as never)}
          />
        ),
      )}
    </div>
  );
}

function QuickIconButton({
  action,
  pending,
  onClick,
  label,
}: {
  action: Exclude<QuickAction, { confirm: true }>;
  pending: boolean;
  onClick: () => void;
  label: string;
}) {
  const Icon =
    action.kind === "ARRIVED"
      ? UserCheckIcon
      : action.kind === "START"
        ? PlayIcon
        : CheckCheckIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md transition-colors",
        "text-muted-foreground hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      {pending ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
    </button>
  );
}

function NoShowButton({
  pending,
  onConfirm,
  label,
  confirmTitle,
  confirmYes,
  confirmNo,
}: {
  pending: boolean;
  onConfirm: () => void;
  label: string;
  confirmTitle: string;
  confirmYes: string;
  confirmNo: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={label}
          title={label}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md transition-colors",
            "text-destructive/70 hover:bg-destructive/10 hover:text-destructive",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {pending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <UserXIcon className="size-3.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <div className="text-xs font-medium text-foreground">
          {confirmTitle}
        </div>
        <div className="mt-2 flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setOpen(false)}
          >
            {confirmNo}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmYes}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function labelKeyFor(kind: QuickAction["kind"]): string {
  switch (kind) {
    case "ARRIVED":
      return "arrived";
    case "START":
      return "start";
    case "COMPLETE":
      return "complete";
    case "NO_SHOW":
      return "noShow";
  }
}

function toastKeyFor(kind: QuickAction["kind"]): string {
  switch (kind) {
    case "ARRIVED":
      return "toast.arrived";
    case "START":
      return "toast.started";
    case "COMPLETE":
      return "toast.completed";
    case "NO_SHOW":
      return "toast.noShow";
  }
}

function formatTime(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function formatQueueTime(date: Date, locale: string, now = new Date()): string {
  const diffMin = Math.round((date.getTime() - now.getTime()) / 60000);
  if (diffMin > 0 && diffMin < 60) {
    return `+${diffMin}m`;
  }
  return formatTime(date, locale);
}
