"use client";

import { useQuery } from "@tanstack/react-query";

export type PatientAppointment = {
  id: string;
  date: string;
  time: string | null;
  durationMin: number;
  status: string;
  queueStatus: string;
  priceFinal: number | null;
  priceBase: number | null;
  discountPct: number;
  comments: string | null;
  notes: string | null;
  doctor: {
    id: string;
    nameRu: string;
    nameUz: string;
    photoUrl: string | null;
    color: string;
  };
  cabinet: { id: string; number: string } | null;
  primaryService: { id: string; nameRu: string; nameUz: string } | null;
  services: Array<{
    serviceId: string;
    priceSnap: number;
    quantity: number;
    service: {
      id: string;
      nameRu: string;
      nameUz: string;
      priceBase: number;
    };
  }>;
  payments: Array<{
    id: string;
    amount: number;
    status: string;
    method: string;
  }>;
};

export type AppointmentsListResponse = {
  rows: PatientAppointment[];
  nextCursor: string | null;
  total: number;
};

export function usePatientAppointments(patientId: string) {
  return useQuery<AppointmentsListResponse, Error>({
    queryKey: ["patient", patientId, "appointments"],
    queryFn: async () => {
      const res = await fetch(
        `/api/crm/appointments?patientId=${encodeURIComponent(patientId)}&sort=date&dir=desc&limit=100`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AppointmentsListResponse;
    },
    staleTime: 15_000,
  });
}
