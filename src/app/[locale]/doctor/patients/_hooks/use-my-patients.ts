"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

export type DoctorPatientTab =
  | "all"
  | "today"
  | "active"
  | "new"
  | "watch"
  | "returned"
  | "dormant";

/** One row as returned by `GET /api/crm/doctors/me/patients`. */
export type DoctorPatientRow = {
  id: string;
  fullName: string;
  photoUrl: string | null;
  birthDate: string | null;
  phone: string;
  segment: "NEW" | "ACTIVE" | "DORMANT" | "VIP" | "CHURN";
  hasActiveAppointment: boolean;
  lastVisitWithMeAt: string | null;
  lastDiagnosisCode: string | null;
  lastDiagnosisName: string | null;
  nextAppointmentWithMeAt: string | null;
};

export type DoctorPatientsResponse = {
  rows: DoctorPatientRow[];
  nextCursor: string | null;
  total: number;
};

export type DoctorPatientsFilters = {
  q?: string;
  tab?: DoctorPatientTab;
};

function buildSearch(
  filters: DoctorPatientsFilters,
  cursor?: string,
  limit = 50,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.tab) params.set("tab", filters.tab);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return params.toString();
}

export function myPatientsKey(filters: DoctorPatientsFilters) {
  return ["doctor", "me", "patients", filters] as const;
}

export function useMyPatients(filters: DoctorPatientsFilters, limit = 50) {
  return useInfiniteQuery<
    DoctorPatientsResponse,
    Error,
    { pages: DoctorPatientsResponse[]; pageParams: (string | undefined)[] },
    ReturnType<typeof myPatientsKey>,
    string | undefined
  >({
    queryKey: myPatientsKey(filters),
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const qs = buildSearch(filters, pageParam, limit);
      const res = await fetch(`/api/crm/doctors/me/patients?${qs}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to load patients: ${res.status}`);
      }
      return (await res.json()) as DoctorPatientsResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function flattenDoctorPatients(
  data: { pages: DoctorPatientsResponse[] } | undefined,
): DoctorPatientRow[] {
  if (!data) return [];
  const out: DoctorPatientRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}
