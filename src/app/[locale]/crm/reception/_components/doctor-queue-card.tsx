"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { BellRingIcon, CheckIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { BadgeStatus } from "@/components/atoms/badge-status";
import { EmptyState } from "@/components/atoms/empty-state";
import { useQueryClient } from "@tanstack/react-query";

import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";
import type { DoctorRef } from "../_hooks/use-reception-live";

export interface DoctorQueueCardProps {
  doctor: DoctorRef;
  appointments: AppointmentRow[];
  onRowClick: (appointmentId: string) => void;
  className?: string;
}

type QueueRow = {
  appointment: AppointmentRow;
  kind: "current" | "next" | "upcoming";
};

/**
 * Per-doctor card per TZ §6.1.3. Shows the current in-progress patient,
 * the next waiting patient and up to three upcoming records. Primary CTAs:
 *
 *  - **Вызвать следующего** — move the `WAITING` → `IN_PROGRESS`.
 *    Falls back to moving a `BOOKED` patient straight into consultation if
 *    no one is explicitly WAITING yet (walk-in flow).
 *  - **Пришёл** — optimistically move `BOOKED` → `WAITING`.
 *  - **Завершить** — move the current `IN_PROGRESS` → `COMPLETED`.
 *  - **Не пришёл** — mark a `BOOKED` / `WAITING` record as `NO_SHOW` via the
 *    main PATCH endpoint (queue-status endpoint only allows the live states).
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
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  // Partition.
  const current = appointments.find((a) => a.queueStatus === "IN_PROGRESS") ?? null;
  const waiting = appointments.filter((a) => a.queueStatus === "WAITING");
  const booked = appointments.filter((a) => a.queueStatus === "BOOKED");
  const upcoming = [...waiting, ...booked].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const backlog = Math.max(0, upcoming.length - (current ? 2 : 3));
  const visibleRows: QueueRow[] = [];
  if (current) visibleRows.push({ appointment: current, kind: "current" });
  const takeNext = current ? 2 : 3;
  upcoming.slice(0, takeNext).forEach((a, idx) => {
    visibleRows.push({
      appointment: a,
      kind: idx === 0 && !current ? "next" : "upcoming",
    });
  });

  const bookedCount = appointments.length;
  const doneCount = appointments.filter(
    (a) =>
      a.queueStatus === "COMPLETED" ||
      a.queueStatus === "NO_SHOW" ||
      a.queueStatus === "SKIPPED",
  ).length;
  const loadPct = bookedCount > 0 ? Math.round((doneCount / bookedCount) * 100) : 0;

  const cabinetNumber =
    (current ?? upcoming[0])?.cabinet?.number ??
    appointments[0]?.cabinet?.number ??
    null;

  // ─── mutations (lightweight — no shared hook so the card stays self-contained) ──
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["reception"] });
    qc.invalidateQueries({ queryKey: ["appointments", "list"] });
  };

  const setQueueStatus = async (
    id: string,
    queueStatus: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED",
  ) => {
    setPendingId(id);
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
      setPendingId(null);
    }
  };

  const setStatus = async (
    id: string,
    status: "NO_SHOW" | "CANCELLED",
  ) => {
    setPendingId(id);
    try {
      const res = await fetch(`/api/crm/appointments/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPendingId(null);
    }
  };

  const callNext = () => {
    // Prefer someone already marked WAITING; fall back to next BOOKED.
    const candidate = waiting[0] ?? booked[0];
    if (!candidate) return;
    setQueueStatus(candidate.id, "IN_PROGRESS");
  };

  const canCallNext = !current && (waiting.length > 0 || booked.length > 0);
  const canComplete = Boolean(current);

  const doctorName = locale === "uz" ? doctor.nameUz : doctor.nameRu;
  const doctorSpec =
    locale === "uz" ? doctor.specializationUz : doctor.specializationRu;

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-card",
        "shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      {/* doctor colour stripe — TZ: "Цвет верхней полосы = Doctor.color" */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: doctor.color ?? "#3DD5C0" }}
        aria-hidden
      />

      <header className="flex items-start gap-3 border-b border-border/70 p-3">
        <AvatarWithStatus
          src={doctor.photoUrl}
          name={doctorName}
          size="md"
          status={current ? "busy" : "online"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold leading-tight text-foreground">
                {doctorName}
              </h3>
              {doctorSpec ? (
                <p className="truncate text-xs text-muted-foreground">
                  {doctorSpec}
                  {cabinetNumber ? ` · ${t("cabinet")} ${cabinetNumber}` : ""}
                </p>
              ) : cabinetNumber ? (
                <p className="text-xs text-muted-foreground">
                  {t("cabinet")} {cabinetNumber}
                </p>
              ) : null}
            </div>
            <span
              className={cn(
                "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide",
                current
                  ? "bg-info/15 text-[color:var(--info)]"
                  : "bg-success/15 text-[color:var(--success)]",
              )}
            >
              {current ? t("statusBusy") : t("statusFree")}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 p-3">
        {visibleRows.length === 0 ? (
          <EmptyState
            title={t("noPatients")}
            description={t("noPatientsHint")}
            className="border-dashed bg-card/40"
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visibleRows.map(({ appointment, kind }) => (
              <QueueRow
                key={appointment.id}
                row={appointment}
                kind={kind}
                pending={pendingId === appointment.id}
                onSelect={() => onRowClick(appointment.id)}
                onMarkArrived={
                  appointment.queueStatus === "BOOKED"
                    ? () => setQueueStatus(appointment.id, "WAITING")
                    : undefined
                }
                onNoShow={
                  appointment.queueStatus === "BOOKED" ||
                  appointment.queueStatus === "WAITING"
                    ? () => setStatus(appointment.id, "NO_SHOW")
                    : undefined
                }
                onComplete={
                  appointment.queueStatus === "IN_PROGRESS"
                    ? () => setQueueStatus(appointment.id, "COMPLETED")
                    : undefined
                }
              />
            ))}
          </ul>
        )}

        {backlog > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("backlogCount", { count: backlog })}
          </p>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border/70 px-3 py-2">
        <div className="flex flex-col text-[11px] text-muted-foreground">
          <span>{t("bookedToday", { count: bookedCount })}</span>
          <span>{t("loadPct", { pct: loadPct })}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={callNext}
            disabled={!canCallNext || pendingId !== null}
          >
            <BellRingIcon className="size-3.5" />
            {t("callNext")}
          </Button>
          {canComplete && current ? (
            <Button
              size="sm"
              variant="default"
              onClick={() => setQueueStatus(current.id, "COMPLETED")}
              disabled={pendingId !== null}
            >
              <CheckIcon className="size-3.5" />
              {t("complete")}
            </Button>
          ) : null}
          <Link
            href={`/crm/appointments?doctorId=${doctor.id}&dateMode=today`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "px-2 text-xs",
            )}
          >
            {t("showMore")}
          </Link>
        </div>
      </footer>
    </article>
  );
}

function QueueRow({
  row,
  kind,
  pending,
  onSelect,
  onMarkArrived,
  onNoShow,
  onComplete,
}: {
  row: AppointmentRow;
  kind: "current" | "next" | "upcoming";
  pending: boolean;
  onSelect: () => void;
  onMarkArrived?: () => void;
  onNoShow?: () => void;
  onComplete?: () => void;
}) {
  const t = useTranslations("reception.doctorQueue");
  const locale = useLocale();
  const patientName = row.patient.fullName;
  const time = row.time ?? fmtTime(new Date(row.date), locale);
  const showServiceName =
    row.primaryService &&
    (locale === "uz" ? row.primaryService.nameUz : row.primaryService.nameRu);

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors",
          kind === "current"
            ? "bg-info/5 ring-1 ring-info/20"
            : "hover:border-border hover:bg-muted/50",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={patientName}
        >
          <AvatarWithStatus name={patientName} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {patientName}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {time}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {showServiceName ? (
                <span className="truncate">{showServiceName}</span>
              ) : null}
              {kind === "current" ? (
                <BadgeStatus status="IN_PROGRESS" label={t("rowInProgress")} />
              ) : row.queueStatus === "WAITING" ? (
                <BadgeStatus status="WAITING" label={t("rowArrived")} />
              ) : null}
            </div>
          </div>
        </button>

        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity",
            "group-hover:opacity-100 focus-within:opacity-100",
          )}
        >
          {onMarkArrived ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("markArrived")}
              title={t("markArrived")}
              onClick={onMarkArrived}
              disabled={pending}
            >
              <UserCheckIcon className="size-3.5" />
            </Button>
          ) : null}
          {onComplete ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("complete")}
              title={t("complete")}
              onClick={onComplete}
              disabled={pending}
            >
              <CheckIcon className="size-3.5" />
            </Button>
          ) : null}
          {onNoShow ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("noShow")}
              title={t("noShow")}
              onClick={onNoShow}
              disabled={pending}
            >
              <UserXIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </li>
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
