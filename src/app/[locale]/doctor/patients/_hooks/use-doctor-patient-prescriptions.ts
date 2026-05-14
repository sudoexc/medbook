"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

export type DoctorPatientPrescriptionRow = {
  id: string;
  drugName: string;
  dosage: string;
  schedule: unknown;
  notes: string | null;
  status: string;
  remindersEnabled: boolean;
  caseId: string;
  createdAt: string;
  updatedAt: string;
};

export type DoctorPatientPrescriptionsResponse = {
  rows: DoctorPatientPrescriptionRow[];
  nextCursor: string | null;
};

export function doctorPatientPrescriptionsKey(patientId: string) {
  return ["doctor", "me", "patient", patientId, "prescriptions"] as const;
}

export function useDoctorPatientPrescriptions(
  patientId: string | null | undefined,
  opts: { status?: "all" | "active" } = {},
) {
  const enabled = Boolean(patientId);
  const status = opts.status ?? "active";
  return useInfiniteQuery<
    DoctorPatientPrescriptionsResponse,
    Error,
    {
      pages: DoctorPatientPrescriptionsResponse[];
      pageParams: (string | undefined)[];
    },
    readonly [...ReturnType<typeof doctorPatientPrescriptionsKey>, string],
    string | undefined
  >({
    enabled,
    queryKey: [...doctorPatientPrescriptionsKey(patientId ?? ""), status] as const,
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", "20");
      params.set("status", status);
      const res = await fetch(
        `/api/crm/doctors/me/patients/${patientId}/prescriptions?${params.toString()}`,
        { credentials: "include", signal },
      );
      if (!res.ok) {
        throw new Error(`patient prescriptions: ${res.status}`);
      }
      return (await res.json()) as DoctorPatientPrescriptionsResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function flattenPrescriptions(
  data: { pages: DoctorPatientPrescriptionsResponse[] } | undefined,
): DoctorPatientPrescriptionRow[] {
  if (!data) return [];
  const out: DoctorPatientPrescriptionRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}
