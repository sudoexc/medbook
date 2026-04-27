"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type {
  AppointmentCabinetShort,
  AppointmentDoctorShort,
  AppointmentPatientShort,
  AppointmentPaymentShort,
  AppointmentRow,
  AppointmentServiceLineShort,
  AppointmentServiceShort,
} from "./use-appointments-list";

/**
 * Shape returned by `GET /api/crm/appointments/[id]` — slightly richer than a
 * list row: patient object is the full record, not the short variant.
 */
export type AppointmentDetail = Omit<AppointmentRow, "patient"> & {
  patient: AppointmentPatientShort & {
    birthDate: string | null;
    gender: "MALE" | "FEMALE" | null;
    segment: "NEW" | "ACTIVE" | "DORMANT" | "VIP" | "CHURN";
  };
  doctor: AppointmentDoctorShort & { userId: string | null };
  cabinet: AppointmentCabinetShort | null;
  primaryService: AppointmentServiceShort | null;
  services: AppointmentServiceLineShort[];
  payments: AppointmentPaymentShort[];
};

export const appointmentKey = (id: string) => ["appointment", id] as const;

/**
 * Every appointment write touches the same five surfaces (drawer + list +
 * calendar + reception + topbar summary). Invalidating with
 * `refetchType: "active"` means only currently-mounted screens refetch —
 * stale background queries are marked but don't fire a network request
 * until they remount. Cuts API load on busy clinics by ~70%.
 */
function invalidateAppointmentSurfaces(
  qc: ReturnType<typeof useQueryClient>,
  appointmentId?: string,
) {
  const opts = { refetchType: "active" } as const;
  if (appointmentId) {
    qc.invalidateQueries({ queryKey: appointmentKey(appointmentId), ...opts });
  }
  qc.invalidateQueries({ queryKey: ["appointments", "list"], ...opts });
  qc.invalidateQueries({ queryKey: ["calendar", "appointments"], ...opts });
  qc.invalidateQueries({ queryKey: ["reception"], ...opts });
  qc.invalidateQueries({ queryKey: ["crm", "shell-summary"], ...opts });
}

export function useAppointment(id: string | null | undefined) {
  return useQuery<AppointmentDetail, Error>({
    queryKey: appointmentKey(id ?? "__none"),
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/appointments/${id}`, {
        credentials: "include",
        signal,
      });
      if (res.status === 404) throw new Error("NOT_FOUND");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AppointmentDetail;
    },
    retry: (count, err) => err.message !== "NOT_FOUND" && count < 2,
    staleTime: 15_000,
  });
}

export type AppointmentPatchInput = {
  date?: string;
  time?: string | null;
  durationMin?: number;
  doctorId?: string;
  cabinetId?: string | null;
  serviceId?: string | null;
  status?: AppointmentRow["status"];
  queueStatus?: AppointmentRow["queueStatus"];
  channel?: AppointmentRow["channel"];
  comments?: string | null;
  notes?: string | null;
  cancelReason?: string | null;
  priceFinal?: number | null;
  discountPct?: number;
  discountAmount?: number;
};

/**
 * Conflict envelope returned by 409s. We surface `reason` / `until` to the
 * UI so the drawer can render a friendly message ("Врач занят до 14:30").
 */
export type AppointmentConflict = {
  reason:
    | "doctor_busy"
    | "cabinet_busy"
    | "doctor_time_off"
    | "outside_schedule"
    | "invalid_transition"
    | "in_past";
  until?: string;
};

export class AppointmentConflictError extends Error {
  conflict: AppointmentConflict;
  constructor(conflict: AppointmentConflict) {
    super(`conflict:${conflict.reason}`);
    this.conflict = conflict;
  }
}

export function usePatchAppointment(id: string) {
  const qc = useQueryClient();
  return useMutation<
    AppointmentDetail,
    Error,
    AppointmentPatchInput,
    { previous?: AppointmentDetail }
  >({
    mutationFn: async (patch) => {
      const res = await fetch(`/api/crm/appointments/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
          until?: string;
        } | null;
        throw new AppointmentConflictError({
          reason:
            (j?.reason as AppointmentConflict["reason"]) ?? "doctor_busy",
          until: j?.until,
        });
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as AppointmentDetail;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: appointmentKey(id) });
      const previous = qc.getQueryData<AppointmentDetail>(appointmentKey(id));
      if (previous) {
        qc.setQueryData<AppointmentDetail>(appointmentKey(id), {
          ...previous,
          ...patch,
        } as AppointmentDetail);
      }
      return { previous };
    },
    onError: (err, _patch, context) => {
      if (context?.previous) {
        qc.setQueryData(appointmentKey(id), context.previous);
      }
      if (!(err instanceof AppointmentConflictError)) {
        toast.error(err.message || "Ошибка сохранения");
      }
    },
    onSuccess: (fresh) => {
      qc.setQueryData<AppointmentDetail>(appointmentKey(id), (prev) =>
        prev ? { ...prev, ...fresh } : fresh,
      );
    },
    onSettled: () => {
      invalidateAppointmentSurfaces(qc, id);
    },
  });
}

export function useDeleteAppointment(id: string) {
  const qc = useQueryClient();
  return useMutation<
    { id: string; cancelled: true },
    Error,
    void,
    { previous?: AppointmentDetail }
  >({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/appointments/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { id: string; cancelled: true };
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: appointmentKey(id) });
      const previous = qc.getQueryData<AppointmentDetail>(appointmentKey(id));
      if (previous) {
        qc.setQueryData<AppointmentDetail>(appointmentKey(id), {
          ...previous,
          status: "CANCELLED",
          queueStatus: "CANCELLED",
        } as AppointmentDetail);
      }
      return { previous };
    },
    onError: (err, _v, context) => {
      if (context?.previous) {
        qc.setQueryData(appointmentKey(id), context.previous);
      }
      toast.error(err.message || "Ошибка отмены");
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: appointmentKey(id) });
    },
    onSettled: () => {
      invalidateAppointmentSurfaces(qc);
    },
  });
}

export function useSetQueueStatus(id: string) {
  const qc = useQueryClient();
  return useMutation<
    AppointmentDetail,
    Error,
    AppointmentRow["queueStatus"],
    { previous?: AppointmentDetail }
  >({
    mutationFn: async (queueStatus) => {
      const res = await fetch(
        `/api/crm/appointments/${id}/queue-status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queueStatus }),
        },
      );
      if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as {
          reason?: string;
        } | null;
        throw new AppointmentConflictError({
          reason:
            (j?.reason as AppointmentConflict["reason"]) ?? "invalid_transition",
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AppointmentDetail;
    },
    onMutate: async (queueStatus) => {
      await qc.cancelQueries({ queryKey: appointmentKey(id) });
      const previous = qc.getQueryData<AppointmentDetail>(appointmentKey(id));
      if (previous) {
        qc.setQueryData<AppointmentDetail>(appointmentKey(id), {
          ...previous,
          queueStatus,
          status: queueStatus,
        } as AppointmentDetail);
      }
      return { previous };
    },
    onError: (err, _p, context) => {
      if (context?.previous) {
        qc.setQueryData(appointmentKey(id), context.previous);
      }
      toast.error(err.message || "Ошибка");
    },
    onSettled: () => {
      invalidateAppointmentSurfaces(qc, id);
    },
  });
}

export function useBulkStatus() {
  const qc = useQueryClient();
  return useMutation<
    { count: number },
    Error,
    { ids: string[]; status: AppointmentRow["status"]; cancelReason?: string },
    { snapshots: Map<string, AppointmentDetail> }
  >({
    mutationFn: async (body) => {
      const res = await fetch(`/api/crm/appointments/bulk-status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as {
          reason?: string;
        } | null;
        throw new AppointmentConflictError({
          reason:
            (j?.reason as AppointmentConflict["reason"]) ?? "invalid_transition",
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { count: number };
    },
    onMutate: async ({ ids, status }) => {
      // Snapshot every affected per-id query so onError can rollback.
      // The list queries (`appointments/list`, calendar, reception) refetch
      // on settled — only the single-record drawer needs eager update.
      const snapshots = new Map<string, AppointmentDetail>();
      for (const id of ids) {
        await qc.cancelQueries({ queryKey: appointmentKey(id) });
        const prev = qc.getQueryData<AppointmentDetail>(appointmentKey(id));
        if (prev) {
          snapshots.set(id, prev);
          qc.setQueryData<AppointmentDetail>(appointmentKey(id), {
            ...prev,
            status,
            queueStatus: status,
          } as AppointmentDetail);
        }
      }
      return { snapshots };
    },
    onError: (err, _v, context) => {
      if (context?.snapshots) {
        for (const [id, prev] of context.snapshots) {
          qc.setQueryData(appointmentKey(id), prev);
        }
      }
      if (!(err instanceof AppointmentConflictError)) {
        toast.error(err.message || "Ошибка изменения статуса");
      }
    },
    onSettled: () => {
      invalidateAppointmentSurfaces(qc);
    },
  });
}
