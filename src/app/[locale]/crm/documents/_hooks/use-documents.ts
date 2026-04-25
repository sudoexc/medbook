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

export interface DocumentFilters {
  q: string;
  type: DocumentType | "";
  patientId: string;
  doctorId: string;
  from: string;
  to: string;
  pendingSignature: boolean;
}

export const DEFAULT_FILTERS: DocumentFilters = {
  q: "",
  type: "",
  patientId: "",
  doctorId: "",
  from: "",
  to: "",
  pendingSignature: false,
};

export interface DocumentRow {
  id: string;
  title: string;
  type: DocumentType;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  patient: { id: string; fullName: string } | null;
  appointment: {
    id: string;
    doctor: { id: string; nameRu: string; nameUz: string | null } | null;
  } | null;
  uploadedBy: { id: string; name: string | null } | null;
}

interface ListResponse {
  rows: DocumentRow[];
  nextCursor: string | null;
}

function buildQs(filters: DocumentFilters, cursor: string | null) {
  const sp = new URLSearchParams();
  if (filters.q) sp.set("q", filters.q);
  if (filters.type) sp.set("type", filters.type);
  if (filters.patientId) sp.set("patientId", filters.patientId);
  if (filters.doctorId) sp.set("doctorId", filters.doctorId);
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (filters.pendingSignature) sp.set("pendingSignature", "true");
  if (cursor) sp.set("cursor", cursor);
  sp.set("limit", "50");
  return sp.toString();
}

export function useDocumentsList(filters: DocumentFilters) {
  return useInfiniteQuery({
    queryKey: ["documents", "list", filters],
    queryFn: async ({ pageParam, signal }) => {
      const qs = buildQs(filters, pageParam ?? null);
      const res = await fetch(`/api/crm/documents?${qs}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`documents ${res.status}`);
      return (await res.json()) as ListResponse;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function flattenDocs(
  pages: ListResponse[] | undefined,
): DocumentRow[] {
  if (!pages) return [];
  const out: DocumentRow[] = [];
  for (const p of pages) out.push(...p.rows);
  return out;
}
