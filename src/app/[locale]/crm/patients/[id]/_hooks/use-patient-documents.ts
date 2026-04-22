"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

export type PatientDocument = {
  id: string;
  patientId: string;
  appointmentId: string | null;
  type:
    | "REFERRAL"
    | "PRESCRIPTION"
    | "RESULT"
    | "CONSENT"
    | "CONTRACT"
    | "RECEIPT"
    | "OTHER";
  title: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
};

export type DocumentsListResponse = {
  rows: PatientDocument[];
  nextCursor: string | null;
};

export function usePatientDocuments(patientId: string) {
  return useQuery<DocumentsListResponse, Error>({
    queryKey: ["patient", patientId, "documents"],
    queryFn: async () => {
      const res = await fetch(
        `/api/crm/documents?patientId=${encodeURIComponent(patientId)}&limit=100`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DocumentsListResponse;
    },
    staleTime: 15_000,
  });
}

export type CreateDocumentInput = {
  patientId: string;
  type: PatientDocument["type"];
  title: string;
  fileUrl: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  appointmentId?: string | null;
};

export function useCreateDocument(patientId: string) {
  const qc = useQueryClient();
  return useMutation<PatientDocument, Error, CreateDocumentInput>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/crm/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as PatientDocument;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patientId, "documents"] });
      toast.success("Документ добавлен");
    },
    onError: (e) => toast.error(e.message || "Не удалось загрузить документ"),
  });
}
