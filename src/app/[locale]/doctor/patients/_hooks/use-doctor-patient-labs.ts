"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

export type DoctorPatientLabRow = {
  id: string;
  testName: string;
  testCode: string | null;
  value: string;
  unit: string | null;
  refRange: string | null;
  flag: "NORMAL" | "LOW" | "HIGH" | "CRITICAL" | null;
  notes: string | null;
  status: "PENDING" | "RESULTED" | "REVIEWED" | "ARCHIVED";
  receivedAt: string;
  reviewedAt: string | null;
  orderedByMe: boolean;
};

export type DoctorPatientLabsResponse = {
  rows: DoctorPatientLabRow[];
  nextCursor: string | null;
  total: number;
};

export function doctorPatientLabsKey(patientId: string) {
  return ["doctor", "me", "patient", patientId, "labs"] as const;
}

export function useDoctorPatientLabs(patientId: string | null | undefined) {
  const enabled = Boolean(patientId);
  const query = useInfiniteQuery<
    DoctorPatientLabsResponse,
    Error,
    {
      pages: DoctorPatientLabsResponse[];
      pageParams: (string | undefined)[];
    },
    ReturnType<typeof doctorPatientLabsKey>,
    string | undefined
  >({
    enabled,
    queryKey: doctorPatientLabsKey(patientId ?? ""),
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", "50");
      const res = await fetch(
        `/api/crm/doctors/me/patients/${patientId}/labs?${params.toString()}`,
        { credentials: "include", signal },
      );
      if (!res.ok) {
        throw new Error(`patient labs: ${res.status}`);
      }
      return (await res.json()) as DoctorPatientLabsResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // A new lab arriving (lab.result.received) or a colleague marking one
  // REVIEWED must surface here, otherwise stale labs sit forever. The hook
  // is keyed by patientId — invalidation hits only the active tab.
  useLiveQueryInvalidation({
    events: ["lab.result.received", "lab.result.reviewed"],
    queryKey: doctorPatientLabsKey(patientId ?? ""),
    enabled,
  });

  return query;
}

export function flattenLabs(
  data: { pages: DoctorPatientLabsResponse[] } | undefined,
): DoctorPatientLabRow[] {
  if (!data) return [];
  const out: DoctorPatientLabRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}
