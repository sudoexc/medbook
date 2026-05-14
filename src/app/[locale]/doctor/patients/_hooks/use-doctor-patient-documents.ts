"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

export type DoctorPatientDocumentRow = {
  id: string;
  title: string;
  type: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  appointmentId: string | null;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
};

export type DoctorPatientDocumentsResponse = {
  rows: DoctorPatientDocumentRow[];
  nextCursor: string | null;
};

export function doctorPatientDocumentsKey(patientId: string) {
  return ["doctor", "me", "patient", patientId, "documents"] as const;
}

export function useDoctorPatientDocuments(
  patientId: string | null | undefined,
) {
  const enabled = Boolean(patientId);
  return useInfiniteQuery<
    DoctorPatientDocumentsResponse,
    Error,
    {
      pages: DoctorPatientDocumentsResponse[];
      pageParams: (string | undefined)[];
    },
    ReturnType<typeof doctorPatientDocumentsKey>,
    string | undefined
  >({
    enabled,
    queryKey: doctorPatientDocumentsKey(patientId ?? ""),
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      params.set("limit", "20");
      const res = await fetch(
        `/api/crm/doctors/me/patients/${patientId}/documents?${params.toString()}`,
        { credentials: "include", signal },
      );
      if (!res.ok) {
        throw new Error(`patient documents: ${res.status}`);
      }
      return (await res.json()) as DoctorPatientDocumentsResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function flattenDocuments(
  data: { pages: DoctorPatientDocumentsResponse[] } | undefined,
): DoctorPatientDocumentRow[] {
  if (!data) return [];
  const out: DoctorPatientDocumentRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}
