"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMiniAppFetch } from "./use-miniapp-api";

export type MiniAppAppointment = {
  id: string;
  date: string;
  time: string | null;
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

export function useAppointments(scope: "upcoming" | "past") {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppAppointment[]>({
    queryKey: ["miniapp", "appointments", clinicSlug, scope],
    queryFn: async ({ signal }) => {
      const body = await request<{ appointments: MiniAppAppointment[] }>(
        "/api/miniapp/appointments",
        { searchParams: { scope } },
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
    }): Promise<BookAppointmentResult> => {
      const res = await request<{
        appointment: { id: string; date: string };
        caseAttach: CaseAttachResult;
      }>("/api/miniapp/appointments", {
        method: "POST",
        body: JSON.stringify(body),
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
    },
  });
}

export function useCancelAppointment() {
  const qc = useQueryClient();
  const { request, clinicSlug } = useMiniAppFetch();
  return useMutation({
    mutationFn: async (id: string) => {
      await request(`/api/miniapp/appointments/${id}`, { method: "DELETE" });
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["miniapp", "appointments", clinicSlug],
      });
    },
  });
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
    },
  });
}
