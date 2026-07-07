"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { queuedMs } from "@/lib/queue-ordering";
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
export type AppointmentCaseShort = {
  id: string;
  title: string;
  status: "OPEN" | "RESOLVED" | "ABANDONED" | "TRANSFERRED";
  primaryDoctorId: string | null;
  openedAt: string;
};

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
  medicalCaseId: string | null;
  medicalCase: AppointmentCaseShort | null;
  visitNumberInCase: number | null;
  totalVisitsInCase: number | null;
  // Phase 16 Wave 2 — pre-visit questionnaire (Mini App).
  // The patient fills these via a 24h-before TG push; the CRM drawer reads
  // them via `<PreVisitQuestionnaireCard>`. `preVisitData` is the freeform
  // JSON blob shaped by `PreVisitData`; the API delivers it as `unknown` so
  // the consumer runs `parsePreVisitData` defensively.
  preVisitData: unknown;
  preVisitNotifiedAt: string | null;
  preVisitSubmittedAt: string | null;
  // Phase 16 Wave 2 — post-visit NPS dedupe stamp. Not displayed in the
  // drawer but useful for action-center cross-references.
  npsRequestedAt: string | null;
  // Stage 2.F — confirmation flow. `confirmedAt` is the source of truth for
  // "did the patient (or operator) confirm this visit"; it's set by the
  // booking auto-confirm, manual CRM click, SMS reply, TG button, or
  // inbound call paths (see ConfirmationVia enum). `null` means still
  // outstanding, which is also the predicate the UNCONFIRMED_24H detector
  // uses to surface a row on the call-center widget.
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmedVia:
    | "BOOKING_AUTO"
    | "MANUAL_CRM"
    | "SMS_REPLY"
    | "TG_BUTTON"
    | "INBOUND_CALL"
    | null;
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
  qc.invalidateQueries({ queryKey: ["appointments", "slots"], ...opts });
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
  queuePriority?: number;
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
  const t = useTranslations("crmToasts.appointment");
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
        toast.error(err.message || t("saveFailed"));
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
  const t = useTranslations("crmToasts.appointment");
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
      toast.error(err.message || t("cancelFailed"));
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
  const t = useTranslations("crmToasts.appointment");
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
      toast.error(err.message || t("actionFailed"));
    },
    onSettled: () => {
      invalidateAppointmentSurfaces(qc, id);
    },
  });
}

/**
 * Toggle a patient's live-queue urgency. Optimistically rewrites
 * `queuePriority` on every `["reception","appointments","today",...]` snapshot
 * so the row jumps to the top (or back) instantly; the drag order within a
 * priority band is preserved because the sort falls back to `queueOrder`. On
 * settled we invalidate reception surfaces so kiosk/TV come back in sync.
 */
export function useSetQueuePriority(id: string) {
  const qc = useQueryClient();
  const t = useTranslations("crmToasts.appointment");
  return useMutation<
    AppointmentDetail,
    Error,
    number,
    { snapshots: Array<[readonly unknown[], AppointmentRow[]]> }
  >({
    mutationFn: async (queuePriority) => {
      const res = await fetch(`/api/crm/appointments/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queuePriority }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AppointmentDetail;
    },
    onMutate: async (queuePriority) => {
      await qc.cancelQueries({
        queryKey: ["reception", "appointments", "today"],
      });
      const snapshots: Array<[readonly unknown[], AppointmentRow[]]> = [];
      const entries = qc.getQueriesData<AppointmentRow[]>({
        queryKey: ["reception", "appointments", "today"],
      });
      for (const [key, rows] of entries) {
        if (!rows) continue;
        snapshots.push([key, rows]);
        qc.setQueryData<AppointmentRow[]>(
          key,
          rows.map((r) => (r.id === id ? { ...r, queuePriority } : r)),
        );
      }
      const prevDetail = qc.getQueryData<AppointmentDetail>(appointmentKey(id));
      if (prevDetail) {
        qc.setQueryData<AppointmentDetail>(appointmentKey(id), {
          ...prevDetail,
          queuePriority,
        } as AppointmentDetail);
      }
      return { snapshots };
    },
    onError: (err, _v, context) => {
      if (context?.snapshots) {
        for (const [key, prev] of context.snapshots) {
          qc.setQueryData(key, prev);
        }
      }
      toast.error(err.message || t("actionFailed"));
    },
    onSettled: () => {
      invalidateAppointmentSurfaces(qc, id);
    },
  });
}

export function useBulkReschedule() {
  const qc = useQueryClient();
  const t = useTranslations("crmToasts.appointment");
  return useMutation<
    { count: number; ids: string[] },
    Error,
    { ids: string[]; deltaMinutes: number }
  >({
    mutationFn: async (body) => {
      const res = await fetch(`/api/crm/appointments/bulk-reschedule`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as {
          reason?: string;
          until?: string;
        } | null;
        throw new AppointmentConflictError({
          reason:
            (j?.reason as AppointmentConflict["reason"]) ?? "invalid_transition",
          until: j?.until,
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { count: number; ids: string[] };
    },
    onSuccess: () => {
      invalidateAppointmentSurfaces(qc);
    },
    onError: (err) => {
      if (!(err instanceof AppointmentConflictError)) {
        toast.error(err.message || t("rescheduleFailed"));
      }
    },
  });
}

/**
 * Persist a new top-to-bottom ordering for a single doctor's live queue.
 *
 * Optimistically rewrites the FIFO anchor (`queuedAt`) on every cached
 * `["reception","appointments","today",...]` snapshot — mirroring the server's
 * variant-A reorder — so the list jumps into the new order instantly under the
 * shared EDF comparator. We don't touch the generic `["appointments","list",...]`
 * cache — its query keys are filter-scoped and the reception panel is the only
 * consumer that sorts the live queue. On settled we invalidate all reception
 * surfaces so kiosk/TV come back in sync.
 */
/** Honest response from POST /reorder — see route for `floored` semantics. */
type ReorderResult = {
  count: number;
  exact: boolean;
  effectiveOrder: string[];
};

export function useReorderQueue() {
  const qc = useQueryClient();
  const t = useTranslations("crmToasts.appointment");
  return useMutation<
    ReorderResult,
    Error,
    { doctorId: string; orderedIds: string[] },
    { snapshots: Array<[readonly unknown[], AppointmentRow[]]> }
  >({
    mutationFn: async ({ doctorId, orderedIds }) => {
      const res = await fetch(`/api/crm/appointments/reorder`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, orderedIds }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
        } | null;
        throw new Error(j?.reason ?? j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as ReorderResult;
    },
    onMutate: async ({ orderedIds }) => {
      const orderIndex = new Map(orderedIds.map((id, idx) => [id, idx]));
      // Snapshot every reception-today cache (there can be several — one per
      // forDate) so onError can roll back even if multiple panels are mounted.
      await qc.cancelQueries({ queryKey: ["reception", "appointments", "today"] });
      const snapshots: Array<[readonly unknown[], AppointmentRow[]]> = [];
      const entries = qc.getQueriesData<AppointmentRow[]>({
        queryKey: ["reception", "appointments", "today"],
      });
      for (const [key, rows] of entries) {
        if (!rows) continue;
        snapshots.push([key, rows]);
        // Mirror the server (variant A): anchor at the earliest arrival in the
        // affected set and space rows 1 s apart by rewriting `queuedAt`, so the
        // shared FIFO comparator renders exactly the dragged order. Only
        // live-lane rows are draggable (two-lanes) — bookings never move here.
        const affected = rows.filter((r) => orderIndex.has(r.id));
        if (affected.length === 0) continue;
        const base = Math.min(...affected.map((r) => queuedMs(r)));
        qc.setQueryData<AppointmentRow[]>(
          key,
          rows.map((r) =>
            orderIndex.has(r.id)
              ? {
                  ...r,
                  queuedAt: new Date(
                    base + (orderIndex.get(r.id) ?? 0) * 1000,
                  ).toISOString(),
                }
              : r,
          ),
        );
      }
      return { snapshots };
    },
    onError: (err, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, prev] of context.snapshots) {
          qc.setQueryData(key, prev);
        }
      }
      // Stale client dragged a schedule-lane row (channel flip mid-drag) —
      // the rollback above already restored the list; explain, don't leak
      // the raw reason string.
      if (err.message === "not_live_lane") {
        toast.error(t("reorderNotLive"));
      } else {
        // Machine reasons (duplicate_ids, ids_mismatch, …) are not operator
        // copy — always show the localized failure line.
        toast.error(t("reorderFailed"));
      }
    },
    onSettled: () => {
      invalidateAppointmentSurfaces(qc);
    },
  });
}

export function useBulkStatus() {
  const qc = useQueryClient();
  const t = useTranslations("crmToasts.appointment");
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
        toast.error(err.message || t("statusFailed"));
      }
    },
    onSettled: () => {
      invalidateAppointmentSurfaces(qc);
    },
  });
}
