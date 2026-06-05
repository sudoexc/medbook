"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMiniAppFetch } from "./use-miniapp-api";
import { useLiveEvents } from "@/hooks/use-live-events";

export type MiniAppAppointment = {
  id: string;
  date: string;
  time: string | null;
  ticketCode: string | null;
  durationMin: number;
  status: string;
  channel: string;
  priceFinal: number | null;
  endDate: string;
  doctor: {
    id: string;
    nameRu: string;
    nameUz: string;
    specializationRu: string;
    specializationUz: string;
    photoUrl: string | null;
  };
  cabinet: { id: string; number: string } | null;
  primaryService: { id: string; nameRu: string; nameUz: string } | null;
  services: Array<{
    service: { id: string; nameRu: string; nameUz: string; priceBase: number };
  }>;
  payments: Array<{
    id: string;
    amount: number;
    status: string;
    method: string;
  }>;
};

export function useAppointments(
  scope: "upcoming" | "past",
  activePatientId?: string | null,
) {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppAppointment[]>({
    queryKey: [
      "miniapp",
      "appointments",
      clinicSlug,
      scope,
      activePatientId ?? "self",
    ],
    queryFn: async () => {
      const sp: Record<string, string> = { scope };
      if (activePatientId) sp.onBehalfOf = activePatientId;
      const body = await request<{ appointments: MiniAppAppointment[] }>(
        "/api/miniapp/appointments",
        { searchParams: sp },
      );
      return body.appointments;
    },
  });
}

export type CaseAttachChoice = {
  id: string;
  title: string;
  primaryDoctorName: string | null;
  lastVisitAt: string | null;
  visitCount: number;
};

export type CaseAttachResult =
  | { kind: "auto"; caseId: string }
  | { kind: "created"; caseId: string }
  | { kind: "needs_choice"; choices: CaseAttachChoice[] }
  | { kind: "skipped"; reason: string }
  | null;

export type BookAppointmentResult = {
  id: string;
  date: string;
  caseAttach: CaseAttachResult;
};

export function useBookAppointment() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  return useMutation({
    mutationFn: async (body: {
      doctorId: string;
      serviceIds: string[];
      startAt: string;
      patientName?: string;
      patientPhone?: string;
      lang?: "RU" | "UZ";
      comments?: string;
      onBehalfOf?: string | null;
      // Phase M4 — caller mints a stable id (UUID/ULID) once per
      // confirmation-screen instance so a double-tap MainButton or a
      // network retry collapses to a single booking. The mini-app server
      // (`/api/miniapp/appointments` POST) caches the response for 24h
      // keyed by `<clinicId, patientId, idempotencyKey>`.
      idempotencyKey?: string;
    }): Promise<BookAppointmentResult> => {
      const { idempotencyKey, ...rest } = body;
      // Drop null/undefined keys so the server's z.string().optional()
      // doesn't reject `onBehalfOf: null` (the active-context hook returns
      // null when the patient is booking for themselves).
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== null && v !== undefined) payload[k] = v;
      }
      const res = await request<{
        appointment: { id: string; date: string };
        caseAttach: CaseAttachResult;
      }>("/api/miniapp/appointments", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: idempotencyKey
          ? { "Idempotency-Key": idempotencyKey }
          : undefined,
      });
      return {
        id: res.appointment.id,
        date: res.appointment.date,
        caseAttach: res.caseAttach ?? null,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["miniapp", "appointments", clinicSlug],
      });
      qc.invalidateQueries({
        queryKey: ["miniapp", "slots", clinicSlug],
      });
    },
  });
}

export function useAttachCase() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  return useMutation({
    mutationFn: async (args: {
      appointmentId: string;
      // Mutually exclusive: either pick an existing case, or create a new one.
      caseId?: string;
      create?: boolean;
      title?: string;
      primaryComplaint?: string;
    }) => {
      const res = await request<{
        caseId: string;
        kind: "created" | "attached";
        title: string;
      }>(`/api/miniapp/appointments/${args.appointmentId}/attach-case`, {
        method: "POST",
        body: JSON.stringify({
          caseId: args.caseId,
          create: args.create,
          title: args.title,
          primaryComplaint: args.primaryComplaint,
        }),
      });
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["miniapp", "appointments", clinicSlug],
      });
      qc.invalidateQueries({
        queryKey: ["miniapp", "slots", clinicSlug],
      });
    },
  });
}

export function useCancelAppointment() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  return useMutation({
    mutationFn: async (args: { id: string; reason?: string | null }) => {
      const { id, reason } = args;
      // Only send a body when the patient actually supplied a reason; the
      // DELETE handler accepts both empty body and `{ reason }` shape per TZ.
      const init: RequestInit =
        reason != null
          ? {
              method: "DELETE",
              body: JSON.stringify({ reason }),
              headers: { "Content-Type": "application/json" },
            }
          : { method: "DELETE" };
      await request(`/api/miniapp/appointments/${id}`, init);
      return id;
    },
    // Phase M4 — Optimistic update. The patient taps "Cancel" and expects the
    // row to disappear instantly; the server round-trip can take 200–800ms on
    // mobile. We mark the row as CANCELLED across every cached scope (upcoming
    // / past / per-relative variants) and roll back on error.
    onMutate: async (vars) => {
      const { id } = vars;
      await qc.cancelQueries({
        queryKey: ["miniapp", "appointments", clinicSlug],
      });
      const snapshots: Array<[unknown[], MiniAppAppointment[] | undefined]> = [];
      qc.getQueriesData<MiniAppAppointment[]>({
        queryKey: ["miniapp", "appointments", clinicSlug],
      }).forEach(([key, value]) => {
        snapshots.push([key as unknown[], value]);
        if (!value) return;
        qc.setQueryData<MiniAppAppointment[]>(
          key as unknown[],
          value.map((a) => (a.id === id ? { ...a, status: "CANCELLED" } : a)),
        );
      });
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.snapshots) return;
      for (const [key, value] of ctx.snapshots) {
        qc.setQueryData(key, value);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({
        queryKey: ["miniapp", "appointments", clinicSlug],
      });
      qc.invalidateQueries({
        queryKey: ["miniapp", "slots", clinicSlug],
      });
    },
  });
}

/**
 * Subscribe the mini-app to the SSE event bus so cross-surface mutations
 * (e.g. receptionist cancels in CRM while the patient has the mini-app open)
 * land in ≤2 sec without a manual refetch. Per TZ §6.1.
 *
 * We invalidate both `appointments` (the list itself) and `slots` because
 * a cancel / move frees up a slot the patient might be browsing in the
 * reschedule picker. TanStack coalesces multiple invalidate calls into a
 * single refetch — no extra debounce needed.
 */
export function useAppointmentsLiveSync(): void {
  const qc = useQueryClient();
  const { clinicSlug } = useMiniAppFetch();
  useLiveEvents(
    () => {
      qc.invalidateQueries({
        queryKey: ["miniapp", "appointments", clinicSlug],
      });
      qc.invalidateQueries({
        queryKey: ["miniapp", "slots", clinicSlug],
      });
    },
    {
      filter: [
        "appointment.created",
        "appointment.updated",
        "appointment.statusChanged",
        "appointment.cancelled",
        "appointment.moved",
      ],
    },
  );
}

export function useRescheduleAppointment() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      startAt: string;
      doctorId?: string;
      serviceIds?: string[];
    }) => {
      await request(`/api/miniapp/appointments/${args.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          startAt: args.startAt,
          doctorId: args.doctorId,
          serviceIds: args.serviceIds,
        }),
      });
      return args.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["miniapp", "appointments", clinicSlug],
      });
      qc.invalidateQueries({
        queryKey: ["miniapp", "slots", clinicSlug],
      });
    },
  });
}
