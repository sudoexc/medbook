"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
  /** Per-patient sequence: `#1` is the oldest, `#N` the newest upload. */
  seq: number;
};

/**
 * The stored `fileUrl` is either the raw MinIO URL (private bucket → direct
 * GET fails with AccessDenied) or a base64 signature `data:` URL. The streaming
 * route at `/api/crm/documents/file?key=…` is the only path with tenant scoping
 * + the docker-internal MinIO endpoint, so route every persisted file through
 * it. Signature data URLs are passed through unchanged.
 */
export function documentDownloadHref(fileUrl: string): string {
  if (fileUrl.startsWith("data:")) return fileUrl;
  const idx = fileUrl.indexOf("/clinics/");
  if (idx < 0) return fileUrl;
  const key = fileUrl.slice(idx + 1);
  return `/api/crm/documents/file?key=${encodeURIComponent(key)}`;
}

export type DocumentsListResponse = {
  rows: PatientDocument[];
  nextCursor: string | null;
};

export type DocumentTypeFilter = PatientDocument["type"] | "ALL";

export type PatientDocumentsFilters = {
  /** Free-text search — filename, patient name, phone. */
  q?: string;
  /** Document type narrowing; "ALL" or omitted means no filter. */
  type?: DocumentTypeFilter;
};

const PAGE_SIZE = 30;

/**
 * Single-shot fetch retained for surfaces that just want "the first page of
 * documents" (the right-rail summary). Internally uses the same paginated
 * endpoint; we only render the first 50 rows here.
 */
export function usePatientDocuments(patientId: string) {
  return useQuery<DocumentsListResponse, Error>({
    queryKey: ["patient", patientId, "documents"],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/documents?patientId=${encodeURIComponent(patientId)}&limit=50`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DocumentsListResponse;
    },
    staleTime: 15_000,
  });
}

/**
 * Cursor-paginated infinite query for the patient-card Documents tab.
 *
 * The server uses Prisma `cursor + skip:1` on the `id` column, ordered by
 * `createdAt desc`. `?q=` and `?type=` are passed straight through to the
 * list endpoint — keep the filter values in the query key so cache buckets
 * stay separate per filter combo.
 */
export function usePatientDocumentsInfinite(
  patientId: string,
  filters: PatientDocumentsFilters = {},
) {
  const q = filters.q?.trim() ?? "";
  const type = filters.type && filters.type !== "ALL" ? filters.type : undefined;
  return useInfiniteQuery<
    DocumentsListResponse,
    Error,
    { pages: DocumentsListResponse[]; pageParams: (string | undefined)[] },
    readonly [
      "patient",
      string,
      "documents",
      "infinite",
      { q: string; type: string | undefined },
    ],
    string | undefined
  >({
    queryKey: [
      "patient",
      patientId,
      "documents",
      "infinite",
      { q, type },
    ] as const,
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("patientId", patientId);
      params.set("limit", String(PAGE_SIZE));
      if (q) params.set("q", q);
      if (type) params.set("type", type);
      if (pageParam) params.set("cursor", pageParam);
      const res = await fetch(`/api/crm/documents?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DocumentsListResponse;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });
}

export function flattenDocuments(
  data: { pages: DocumentsListResponse[] } | undefined,
): PatientDocument[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.rows);
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
  const t = useTranslations("crmToasts.patient");
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
      toast.success(t("documentAdded"));
    },
    onError: (e) => toast.error(e.message || t("documentFailed")),
  });
}

export function useDeleteDocument(patientId: string) {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: async (documentId) => {
      const res = await fetch(
        `/api/crm/documents/${encodeURIComponent(documentId)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (res.status === 403) {
          throw new Error("FORBIDDEN");
        }
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patientId, "documents"] });
    },
  });
}
