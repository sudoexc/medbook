"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClockIcon, Loader2Icon, PhoneCallIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { splitLanes } from "@/lib/queue-ordering";

import { useReceptionContext } from "../_hooks/reception-context";
import { doctorQueueKey, type QueueAppointment } from "../_hooks/use-doctor-queue";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

const ACTIVE_STATUSES = new Set([
  "BOOKED",
  "WAITING",
  "IN_PROGRESS",
]);

function STATUS_LABEL(
  s: QueueAppointment["status"],
  t: (key: string) => string,
): string {
  switch (s) {
    case "BOOKED":
      return t("queue.status.booked");
    case "WAITING":
      return t("queue.status.waiting");
    case "IN_PROGRESS":
      return t("queue.status.inProgress");
    case "COMPLETED":
      return t("queue.status.completed");
    case "CANCELLED":
      return t("queue.status.cancelled");
    case "NO_SHOW":
      return t("queue.status.noShow");
    case "SKIPPED":
      return t("queue.status.skipped");
    default:
      return s;
  }
}

export function QueueCard() {
  const t = useTranslations("doctor.reception");
  const { queue, queueLoading, setPickAppointmentId } = useReceptionContext();
  const qc = useQueryClient();

  const active = queue.filter((a) => ACTIVE_STATUSES.has(a.status));
  // Two-lanes model (docs/TZ-two-lanes.md): walk-ins are a timeless FIFO
  // («Живая очередь», ordered by the shared compareQueue), bookings are a
  // slot-time list («Записи», API already sorts by date asc). No mixing —
  // the doctor picks a row from either section explicitly.
  const { live, schedule: booked } = splitLanes(active);
  const total = queue.length;
  const inProgress = queue.find((a) => a.status === "IN_PROGRESS") ?? null;

  const setStatus = useMutation<
    QueueAppointment,
    Error,
    { id: string; status: "IN_PROGRESS" | "WAITING" | "BOOKED" }
  >({
    mutationFn: async ({ id, status }) => {
      const res = await fetch(`/api/crm/appointments/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        let reason = "";
        try {
          const j = (await res.json()) as { reason?: string };
          reason = j.reason ?? "";
        } catch {
          // non-JSON body — fall through to a generic message.
        }
        throw new Error(reason || `appointments ${res.status}`);
      }
      return (await res.json()) as QueueAppointment;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: doctorQueueKey });
    },
    onError: (e) => {
      toast.error(
        e.message === "another_visit_in_progress"
          ? t("queue.anotherInProgress")
          : t("queue.startFailed"),
      );
    },
  });

  const onStart = async (row: QueueAppointment) => {
    // If another visit is active, switch the previous one to WAITING first.
    if (inProgress && inProgress.id !== row.id) {
      const confirmSwitch = window.confirm(
        t("queue.switchConfirm", {
          current: inProgress.patient.fullName,
          next: row.patient.fullName,
        }),
      );
      if (!confirmSwitch) return;
      await setStatus.mutateAsync({ id: inProgress.id, status: "WAITING" });
    }
    await setStatus.mutateAsync({ id: row.id, status: "IN_PROGRESS" });
    setPickAppointmentId(row.id);
  };

  const onDefer = async (row: QueueAppointment) => {
    await setStatus.mutateAsync({ id: row.id, status: "WAITING" });
  };

  // Shared row renderer for both sections — the per-row actions are
  // identical, only the grouping and the position index (per-section,
  // 1-based) differ.
  const renderRow = (p: QueueAppointment, i: number) => {
    const isActive = p.status === "IN_PROGRESS";
    return (
      <li
        key={p.id}
        className={cn(
          "flex items-center gap-3 px-4 py-2.5 transition-colors",
          isActive ? "bg-success/5" : "hover:bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums",
            isActive
              ? "bg-success/15 text-success"
              : "bg-muted text-muted-foreground",
          )}
        >
          {i + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {p.patient.fullName}
          </div>
          <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClockIcon className="size-3" />
            <span className="tabular-nums">{formatTime(p.date)}</span>
            <span>·</span>
            <span>{STATUS_LABEL(p.status, t)}</span>
          </div>
        </div>
        {isActive ? (
          <button
            type="button"
            onClick={() => setPickAppointmentId(p.id)}
            className="inline-flex h-7 items-center rounded-lg bg-success/10 px-2.5 text-xs font-semibold text-success transition-colors hover:bg-success/15"
          >
            {t("queue.open")}
          </button>
        ) : (
          <div className="inline-flex shrink-0 items-center gap-1.5">
            {p.status !== "WAITING" && (
              <button
                type="button"
                disabled={setStatus.isPending}
                onClick={() => onDefer(p)}
                className="inline-flex h-7 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                {t("queue.defer")}
              </button>
            )}
            <button
              type="button"
              disabled={setStatus.isPending}
              onClick={() => onStart(p)}
              className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary/10 px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 disabled:opacity-60"
            >
              {setStatus.isPending && (
                <Loader2Icon className="size-3 animate-spin" />
              )}
              {t("queue.start")}
            </button>
          </div>
        )}
      </li>
    );
  };

  const sectionLabel = (label: string, count: number) => (
    <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <span className="tabular-nums">· {count}</span>
    </div>
  );

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card">
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{t("queue.title")}</h3>
          <div className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
            {t("queue.totalToday", { total })}
          </div>
        </div>
        {inProgress && (
          <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-success/10 px-2 text-xs font-semibold text-success">
            <PhoneCallIcon className="size-3.5" />
            {t("queue.inProgressBadge", {
              name: inProgress.patient.fullName.split(/\s+/)[0],
            })}
          </span>
        )}
      </header>

      {queueLoading ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("queue.loading")}
        </div>
      ) : active.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("queue.empty")}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col">
          {live.length > 0 && (
            <>
              {sectionLabel(t("queue.sectionLive"), live.length)}
              <ul className="divide-y divide-border">{live.map(renderRow)}</ul>
            </>
          )}
          {booked.length > 0 && (
            <>
              {sectionLabel(t("queue.sectionBooked"), booked.length)}
              <ul className="divide-y divide-border">
                {booked.map(renderRow)}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
