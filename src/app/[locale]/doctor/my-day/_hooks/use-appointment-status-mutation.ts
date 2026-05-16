"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { AppointmentStatus } from "@/lib/appointment-transitions";
import { scheduleStatusOf } from "@/lib/doctor-schedule-status";

import {
  doctorTodayKey,
  type CurrentPatient,
  type DoctorToday,
  type ScheduleEntry,
} from "./use-doctor-today";
import { doctorScheduleKey, type DoctorSchedule } from "./use-doctor-schedule";

export type StatusMutationArgs = {
  appointmentId: string;
  /**
   * Forward status target. Ignored when `call` is true — the call branch
   * stamps `calledAt` server-side and may bump BOOKED → WAITING, but the
   * caller doesn't pick a target status explicitly.
   */
  toStatus: AppointmentStatus;
  /** When true, hits PATCH with `?revert=true` (bypasses forward guard). */
  revert?: boolean;
  /**
   * When true, hits PATCH with `?call=true` — doctor pressed "Вызвать
   * пациента". Server stamps `calledAt`, bumps BOOKED → WAITING when
   * needed, and fires the patient-facing Telegram "проходите в кабинет".
   */
  call?: boolean;
};

type Snapshot = {
  today: DoctorToday | undefined;
  schedule: DoctorSchedule | undefined;
};

/**
 * Doctor-facing status flip for an appointment with optimistic write-through
 * to both `/my-day` query caches.
 *
 * Why optimistic and not "just invalidate":
 *   The click happens on the same page that reads the data. With pure
 *   invalidation TanStack flips into "fetching" state and the row reverts
 *   to its prior status for ~150-300ms during the refetch — a visible
 *   "snap-back" that reads as a bug. Patching the cache synchronously
 *   makes the click feel instant, with the network roundtrip as a silent
 *   reconciliation.
 *
 * Two caches are touched:
 *   - `doctorTodayKey` (the /api/.../today aggregate, drives every card on
 *     /my-day, incl. CurrentPatientCard)
 *   - `doctorScheduleKey(dateKey)` (per-date schedule grid)
 *
 * The "current" patient slot is special: when a doctor completes a visit,
 * `current` ought to either go null or be replaced by the next IN_PROGRESS
 * candidate. We don't know which on the client, so we just null it out
 * optimistically and let the settled refetch fill in the next patient.
 *
 * `dateKey` should be today's date in YYYY-MM-DD (matching the key the
 * ScheduleCard uses to read its slice). Pass null when no schedule view
 * is mounted — the mutation will still patch /today and rely on the SSE
 * fan-out to reconcile the rest.
 */
export function useAppointmentStatusMutation(dateKey: string | null) {
  const qc = useQueryClient();

  return useMutation<unknown, Error, StatusMutationArgs, Snapshot>({
    mutationFn: async ({ appointmentId, toStatus, revert, call }) => {
      const url = call
        ? `/api/crm/appointments/${appointmentId}?call=true`
        : revert
          ? `/api/crm/appointments/${appointmentId}?revert=true`
          : `/api/crm/appointments/${appointmentId}`;
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        // Call branch ignores the body server-side, but sending `{}` keeps
        // the content-type header honest.
        body: call ? "{}" : JSON.stringify({ status: toStatus }),
      });
      if (!res.ok) {
        let reason = "";
        try {
          const j = (await res.json()) as {
            error?: { reason?: string; code?: string; message?: string };
          };
          reason =
            j.error?.reason ?? j.error?.code ?? j.error?.message ?? "";
        } catch {
          // body wasn't JSON — fall through to generic message.
        }
        throw new Error(reason || `HTTP ${res.status}`);
      }
      return (await res.json()) as unknown;
    },

    onMutate: async ({ appointmentId, toStatus, call }) => {
      await qc.cancelQueries({ queryKey: doctorTodayKey });
      if (dateKey) {
        await qc.cancelQueries({ queryKey: doctorScheduleKey(dateKey) });
      }
      const today = qc.getQueryData<DoctorToday>(doctorTodayKey);
      const schedule = dateKey
        ? qc.getQueryData<DoctorSchedule>(doctorScheduleKey(dateKey))
        : undefined;

      // Call branch is a state-on-row stamp (`calledAt` + maybe WAITING),
      // not a forward status flip — branched separately so the regular
      // path stays readable.
      if (call) {
        const nowIso = new Date().toISOString();
        if (today) {
          const cur = today.current;
          const currentMatches =
            cur !== null && cur.appointmentId === appointmentId;
          const nextCurrent: CurrentPatient | null = currentMatches
            ? {
                ...cur,
                calledAt: nowIso,
                status: cur.status === "BOOKED" ? "WAITING" : cur.status,
              }
            : cur;
          // Schedule entry's `status` is a mapped category ("upcoming" /
          // "in_progress" / …). BOOKED and WAITING both map to "upcoming",
          // so the BOOKED → WAITING server bump doesn't change the row's
          // schedule status — we only stamp `calledAt`.
          const next: DoctorToday = {
            ...today,
            schedule: today.schedule.map((e: ScheduleEntry) =>
              e.id === appointmentId ? { ...e, calledAt: nowIso } : e,
            ),
            current: nextCurrent,
          };
          qc.setQueryData(doctorTodayKey, next);
        }
        if (schedule && dateKey) {
          const next: DoctorSchedule = {
            ...schedule,
            entries: schedule.entries.map((e) =>
              e.id === appointmentId ? { ...e, calledAt: nowIso } : e,
            ),
          };
          qc.setQueryData(doctorScheduleKey(dateKey), next);
        }
        return { today, schedule };
      }

      const mappedScheduleStatus = scheduleStatusOf(toStatus);

      // doctorTodayKey — flip the schedule entry + current.status; null
      // current out when the visit completes / cancels so the UI shows the
      // "next patient" placeholder until the refetch lands.
      if (today) {
        const cur = today.current;
        const currentMatches =
          cur !== null && cur.appointmentId === appointmentId;
        let nextCurrent: CurrentPatient | null = cur;
        if (currentMatches) {
          if (
            toStatus === "COMPLETED" ||
            toStatus === "CANCELLED" ||
            toStatus === "NO_SHOW"
          ) {
            nextCurrent = null;
          } else {
            nextCurrent = {
              ...cur,
              status: toStatus,
              // When the doctor presses "Начать приём", stamp startedAt
              // immediately so the local timer flips into elapsed-mode
              // without waiting for the server roundtrip.
              startedAt:
                toStatus === "IN_PROGRESS"
                  ? new Date().toISOString()
                  : cur.startedAt,
            };
          }
        }
        const next: DoctorToday = {
          ...today,
          schedule: today.schedule.map((e: ScheduleEntry) =>
            e.id === appointmentId
              ? { ...e, status: mappedScheduleStatus }
              : e,
          ),
          current: nextCurrent,
        };
        qc.setQueryData(doctorTodayKey, next);
      }

      if (schedule && dateKey) {
        const next: DoctorSchedule = {
          ...schedule,
          entries: schedule.entries.map((e) =>
            e.id === appointmentId
              ? { ...e, status: mappedScheduleStatus }
              : e,
          ),
        };
        qc.setQueryData(doctorScheduleKey(dateKey), next);
      }

      return { today, schedule };
    },

    onError: (err, args, snapshot) => {
      if (snapshot?.today) {
        qc.setQueryData(doctorTodayKey, snapshot.today);
      }
      if (snapshot?.schedule && dateKey) {
        qc.setQueryData(doctorScheduleKey(dateKey), snapshot.schedule);
      }
      toast.error(messageFor(args, err.message));
    },

    onSuccess: (_data, args) => {
      const label = successFor(args);
      if (label) toast.success(label);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: doctorTodayKey });
      if (dateKey) {
        qc.invalidateQueries({ queryKey: doctorScheduleKey(dateKey) });
      }
      // /patients reads `hasActiveAppointment` per row — without this the
      // "На приёме" badge only appears after a manual refresh.
      qc.invalidateQueries({ queryKey: ["doctor", "me", "patients"] });
    },
  });
}

function successFor(args: StatusMutationArgs): string | null {
  if (args.call) return "Пациент вызван";
  if (args.revert) return "Шаг назад выполнен";
  switch (args.toStatus) {
    case "WAITING":
      return "Пациент в ожидании";
    case "IN_PROGRESS":
      return "Приём начат";
    case "COMPLETED":
      return "Приём завершён";
    case "NO_SHOW":
      return "Отмечено: не пришёл";
    case "CANCELLED":
      return "Приём отменён";
    default:
      return null;
  }
}

function messageFor(args: StatusMutationArgs, raw: string): string {
  // Surface the most common server-side rejections as plain language.
  if (raw === "too_early_for_no_show") {
    return "Слишком рано — приём ещё не должен был начаться";
  }
  if (raw === "invalid_transition") {
    return "Этот переход статуса не разрешён";
  }
  if (raw === "not_revertable") {
    return "Этот статус нельзя отменить";
  }
  if (raw === "revert_target_mismatch") {
    return "Не удалось определить, к чему откатить";
  }
  if (args.call) return "Не удалось вызвать пациента";
  return args.revert ? "Не удалось отменить шаг" : "Не удалось обновить статус";
}
