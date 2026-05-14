"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

export type DoctorPatientVisitRow = {
  id: string;
  date: string;
  endDate: string;
  durationMin: number;
  type: "consultation" | "repeat";
  doctorName: string;
  doctorSpecialty: string;
  serviceName: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  prescriptions: string[];
  advice: string[];
  hasVisitNote: boolean;
  visitNoteId: string | null;
};

export type DoctorPatientVisitsResponse = {
  rows: DoctorPatientVisitRow[];
  nextCursor: string | null;
  total: number;
};

export function doctorPatientVisitsKey(patientId: string) {
  return ["doctor", "me", "patient", patientId, "visits"] as const;
}

export function useDoctorPatientVisits(patientId: string | null | undefined) {
  const enabled = Boolean(patientId);
  return useInfiniteQuery<
    DoctorPatientVisitsResponse,
    Error,
    {
      pages: DoctorPatientVisitsResponse[];
      pageParams: (string | undefined)[];
    },
    ReturnType<typeof doctorPatientVisitsKey>,
    string | undefined
  >({
    enabled,
    queryKey: doctorPatientVisitsKey(patientId ?? ""),
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", "20");
      const res = await fetch(
        `/api/crm/doctors/me/patients/${patientId}/visits?${params.toString()}`,
        { credentials: "include", signal },
      );
      if (!res.ok) {
        throw new Error(`patient visits: ${res.status}`);
      }
      return (await res.json()) as DoctorPatientVisitsResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function flattenVisits(
  data: { pages: DoctorPatientVisitsResponse[] } | undefined,
): DoctorPatientVisitRow[] {
  if (!data) return [];
  const out: DoctorPatientVisitRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}
