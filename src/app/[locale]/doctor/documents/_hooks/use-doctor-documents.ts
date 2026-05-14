"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

export type DocumentType =
  | "REFERRAL"
  | "PRESCRIPTION"
  | "RESULT"
  | "CONSENT"
  | "CONTRACT"
  | "RECEIPT"
  | "OTHER";

export type DoctorDocumentRow = {
  id: string;
  patientId: string;
  appointmentId: string | null;
  type: DocumentType;
  title: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedById: string | null;
  createdAt: string;
  patient: { id: string; fullName: string } | null;
  uploadedBy: { id: string; name: string } | null;
  appointment: {
    id: string;
    doctor: { id: string; nameRu: string | null; nameUz: string | null } | null;
  } | null;
};

export type DoctorDocumentsResponse = {
  rows: DoctorDocumentRow[];
  nextCursor: string | null;
};

export type DoctorDocumentsFilters = {
  q?: string;
  type?: DocumentType;
};

function buildSearch(
  filters: DoctorDocumentsFilters,
  cursor?: string,
  limit = 50,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.type) params.set("type", filters.type);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return params.toString();
}

export function doctorDocumentsKey(filters: DoctorDocumentsFilters) {
  return ["doctor", "me", "documents", filters] as const;
}

export function useDoctorDocuments(
  filters: DoctorDocumentsFilters,
  limit = 50,
) {
  return useInfiniteQuery<
    DoctorDocumentsResponse,
    Error,
    { pages: DoctorDocumentsResponse[]; pageParams: (string | undefined)[] },
    ReturnType<typeof doctorDocumentsKey>,
    string | undefined
  >({
    queryKey: doctorDocumentsKey(filters),
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const qs = buildSearch(filters, pageParam, limit);
      const res = await fetch(`/api/crm/documents?${qs}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to load documents: ${res.status}`);
      }
      return (await res.json()) as DoctorDocumentsResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function flattenDoctorDocuments(
  data: { pages: DoctorDocumentsResponse[] } | undefined,
): DoctorDocumentRow[] {
  if (!data) return [];
  const out: DoctorDocumentRow[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}
