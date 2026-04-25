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
    }) => {
      const res = await request<{ appointment: { id: string; date: string } }>(
        "/api/miniapp/appointments",
        { method: "POST", body: JSON.stringify(body) },
      );
      return res.appointment;
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
