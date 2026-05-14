"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClockIcon, Loader2Icon, PhoneCallIcon } from "lucide-react";

import { cn } from "@/lib/utils";

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

function STATUS_LABEL(s: QueueAppointment["status"]): string {
  switch (s) {
    case "BOOKED":
      return "Запланирован";
    case "WAITING":
      return "Отложен";
    case "IN_PROGRESS":
      return "На приёме";
    case "COMPLETED":
      return "Завершён";
    case "CANCELLED":
      return "Отменён";
    case "NO_SHOW":
      return "Не пришёл";
    case "SKIPPED":
      return "Пропущен";
    default:
      return s;
  }
}

export function QueueCard() {
  const { queue, queueLoading, setPickAppointmentId } = useReceptionContext();
  const qc = useQueryClient();

  const rows = queue.filter((a) => ACTIVE_STATUSES.has(a.status));
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
      if (!res.ok) throw new Error(`appointments ${res.status}`);
      return (await res.json()) as QueueAppointment;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: doctorQueueKey });
    },
  });

  const onStart = async (row: QueueAppointment) => {
    // If another visit is active, switch the previous one to WAITING first.
    if (inProgress && inProgress.id !== row.id) {
      const confirmSwitch = window.confirm(
        `Сейчас активен приём ${inProgress.patient.fullName}. Отложить его и начать с пациентом ${row.patient.fullName}?`,
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

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card">
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">Очередь</h3>
          <div className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
            Всего сегодня: {total}
          </div>
        </div>
        {inProgress && (
          <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-success/10 px-2 text-xs font-semibold text-success">
            <PhoneCallIcon className="size-3.5" />
            На приёме: {inProgress.patient.fullName.split(/\s+/)[0]}
          </span>
        )}
      </header>

      {queueLoading ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          Загружаем очередь…
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          На сегодня очередь пуста.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p, i) => {
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
                    <span>{STATUS_LABEL(p.status)}</span>
                  </div>
                </div>
                {isActive ? (
                  <button
                    type="button"
                    onClick={() => setPickAppointmentId(p.id)}
                    className="inline-flex h-7 items-center rounded-lg bg-success/10 px-2.5 text-xs font-semibold text-success transition-colors hover:bg-success/15"
                  >
                    Открыть
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
                        Отложить
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
                      Начать
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
