"use client";

import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

export type DoctorPatientSummary = {
  id: string;
  fullName: string;
  phone: string;
  phoneNormalized: string | null;
  birthDate: string | null;
  segment: string | null;
  allergies: Array<{ id: string; substance: string; severity: string }>;
  chronicConditions: Array<{ id: string; name: string }>;
  upcomingAppointment: {
    id: string;
    date: string;
    status: string;
    doctor: { id: string; nameRu: string | null; nameUz: string | null } | null;
  } | null;
  lastDocument: {
    id: string;
    title: string;
    type: string;
    createdAt: string;
  } | null;
};

export function doctorPatientSummaryKey(patientId: string) {
  return ["doctor", "me", "patient", patientId, "summary"] as const;
}

export function useDoctorPatientSummary(patientId: string | null | undefined) {
  const enabled = Boolean(patientId);
  const query = useQuery<DoctorPatientSummary>({
    enabled,
    queryKey: doctorPatientSummaryKey(patientId ?? ""),
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/doctors/me/patients/${patientId}/summary`,
        { credentials: "include", signal },
      );
      if (!res.ok) {
        throw new Error(`patient summary: ${res.status}`);
      }
      return (await res.json()) as DoctorPatientSummary;
    },
    staleTime: 30_000,
  });

  // Refetch when the LLM patient-summary worker rewrites the cache, when an
  // appointment with this patient changes (upcomingAppointment), or when a
  // new document is added (lastDocument).
  useLiveQueryInvalidation({
    events: [
      "patient.summary.refreshed",
      "appointment.created",
      "appointment.updated",
      "appointment.statusChanged",
      "appointment.cancelled",
      "appointment.moved",
    ],
    queryKey: doctorPatientSummaryKey(patientId ?? ""),
  });

  return query;
}
