"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  BellRingIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PauseIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import type { DoctorRef } from "../_hooks/use-reception-live";

export interface DoctorQueueCardProps {
  doctor: DoctorRef;
  appointments: AppointmentRow[];
  onRowClick: (appointmentId: string) => void;
  className?: string;
}

type CabinetState = "in_session" | "waiting" | "idle";

/**
 * "Кабинет" card per docs/1-Ресепшн mockup — grid cell for a single room.
 *
 * Layout:
 *  - header: "Каб [number]" + status pill (НА ПРИЁМЕ / ОЖИДАЕТ / СВОБОДЕН)
 *  - doctor row: avatar + name + spec + small progress "X/Y"
 *  - progress bar: current session elapsed / planned
 *  - "Сейчас у врача" — current patient row (if any)
 *  - "Следующие" — compact queue preview (up to 3)
 *  - footer: Позвать след. + Пауза/Завершить
 */
export function DoctorQueueCard({
  doctor,
  appointments,
  onRowClick,
  className,
}: DoctorQueueCardProps) {
  const t = useTranslations("reception.doctorQueue");
  const locale = useLocale();
  const qc = useQueryClient();
  const [pending, setPending] = React.useState(false);

  const current = appointments.find((a) => a.queueStatus === "IN_PROGRESS") ?? null;
  const waiting = appointments.filter((a) => a.queueStatus === "WAITING");
  const booked = appointments.filter((a) => a.queueStatus === "BOOKED");
  const upcoming = [...waiting, ...booked].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const totalToday = appointments.length;
  const doneCount = appointments.filter(
    (a) =>
      a.queueStatus === "COMPLETED" ||
      a.queueStatus === "NO_SHOW" ||
      a.queueStatus === "SKIPPED",
  ).length;

  const cabinetNumber =
    (current ?? upcoming[0])?.cabinet?.number ??
    appointments[0]?.cabinet?.number ??
    "—";

  const cabinetState: CabinetState = current
    ? "in_session"
    : upcoming.length > 0
      ? "waiting"
      : "idle";

  const doctorName = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const doctorSpec =
    locale === "uz" ? doctor.specializationUz : doctor.specializationRu;

  // Session progress — elapsed since startedAt vs planned duration.
  const sessionProgress = React.useMemo(() => {
    if (!current || !current.startedAt) return null;
    const startedMs = new Date(current.startedAt).getTime();
    const plannedMin = Math.max(15, current.durationMin || 30);
    const elapsedMin = Math.max(
      0,
      Math.round((Date.now() - startedMs) / 60000),
    );
    const pct = Math.min(100, Math.round((elapsedMin / plannedMin) * 100));
    return { elapsedMin, plannedMin, pct };
  }, [current]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["reception"] });
    qc.invalidateQueries({ queryKey: ["appointments", "list"] });
  };

  const setQueueStatus = async (
    id: string,
    queueStatus: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED",
  ) => {
    setPending(true);
    try {
      const res = await fetch(`/api/crm/appointments/${id}/queue-status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const callNext = () => {
    const candidate = waiting[0] ?? booked[0];
    if (!candidate) return;
    setQueueStatus(candidate.id, "IN_PROGRESS");
  };

  const canCallNext = !current && upcoming.length > 0;

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border bg-card",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-block size-1.5 rounded-full"
            style={{ backgroundColor: doctor.color ?? "#2b6cff" }}
            aria-hidden
          />
          <span className="text-sm font-bold text-foreground">
            Каб {cabinetNumber}
          </span>
        </div>
        <CabinetStatePill state={cabinetState} />
      </header>

      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <AvatarWithStatus
          src={doctor.photoUrl}
          name={doctorName}
          size="md"
          status={cabinetState === "in_session" ? "busy" : "online"}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {doctorName}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {doctorSpec ?? t("cabinet")}
          </p>
        </div>
        <div className="text-right leading-tight">
          <div className="text-sm font-bold text-foreground tabular-nums">
            {doneCount}/{totalToday}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            за день
          </div>
        </div>
      </div>

      {cabinetState === "in_session" && current ? (
        <div className="space-y-2 border-b border-border/60 px-4 py-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Текущий приём</span>
            <span className="font-semibold text-foreground tabular-nums">
              {sessionProgress
                ? `${sessionProgress.elapsedMin} мин / ${sessionProgress.plannedMin} мин`
                : `${current.durationMin} мин план`}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-success to-success/80 transition-all"
              style={{ width: `${sessionProgress?.pct ?? 20}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => onRowClick(current.id)}
            className="flex w-full items-center gap-2 rounded-lg bg-success-soft p-2 text-left transition-colors hover:bg-success-soft/80"
          >
            <AvatarWithStatus
              name={current.patient.fullName}
              src={current.patient.photoUrl}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {current.patient.fullName}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {current.primaryService
                  ? locale === "uz"
                    ? current.primaryService.nameUz
                    : current.primaryService.nameRu
                  : "Приём"}
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-[color:var(--success)] tabular-nums">
              {fmtTime(new Date(current.date), locale)}
            </span>
          </button>
        </div>
      ) : (
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {cabinetState === "waiting"
              ? "Следующий пациент ожидает"
              : "Кабинет свободен"}
          </p>
        </div>
      )}

      <div className="flex-1 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Следующие
          </span>
          <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
            {upcoming.length}
          </span>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-xs text-muted-foreground">Очередь пуста</p>
        ) : (
          <ul className="space-y-1.5">
            {upcoming.slice(0, 3).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onRowClick(a.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted"
                >
                  <AvatarWithStatus
                    name={a.patient.fullName}
                    src={a.patient.photoUrl}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {a.patient.fullName}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {fmtTime(new Date(a.date), locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-border px-3 py-2.5">
        <Button
          size="sm"
          className="flex-1"
          onClick={callNext}
          disabled={!canCallNext || pending}
        >
          <BellRingIcon className="size-3.5" />
          Позвать след.
        </Button>
        {current ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setQueueStatus(current.id, "COMPLETED")}
            disabled={pending}
          >
            <CheckIcon className="size-3.5" />
            Завершить
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled
            aria-label="Пауза (в разработке)"
          >
            <PauseIcon className="size-3.5" />
          </Button>
        )}
        <Link
          href={`/crm/appointments?doctorId=${doctor.id}&dateMode=today`}
          aria-label="Подробнее"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <MoreHorizontalIcon className="size-4" />
        </Link>
      </footer>
    </article>
  );
}

function CabinetStatePill({ state }: { state: CabinetState }) {
  const config = {
    in_session: {
      label: "На приёме",
      bg: "bg-success/15",
      fg: "text-[color:var(--success)]",
      dot: "bg-success",
    },
    waiting: {
      label: "Ожидает",
      bg: "bg-warning/15",
      fg: "text-[color:var(--warning)]",
      dot: "bg-warning",
    },
    idle: {
      label: "Свободен",
      bg: "bg-muted",
      fg: "text-muted-foreground",
      dot: "bg-muted-foreground/60",
    },
  }[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        config.bg,
        config.fg,
      )}
    >
      <span className={cn("size-1.5 rounded-full", config.dot)} aria-hidden />
      {config.label}
    </span>
  );
}

function fmtTime(d: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  }
}
