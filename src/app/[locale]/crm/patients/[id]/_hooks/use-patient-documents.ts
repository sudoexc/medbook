"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { documentHref } from "@/lib/storage-ref";
import type { DocumentSourceValue } from "@/lib/document-guards";
import {
  discardDocumentUpload,
  uploadDocumentFile,
} from "@/lib/document-upload-client";
import {
  saveSignature,
  type SignatureCanvas,
  type SignatureDocumentInput,
} from "@/lib/signature-capture";

/** Types staff file by hand; CONCLUSION is rendered by the worker only. */
export type UploadableDocumentType =
  | "REFERRAL"
  | "PRESCRIPTION"
  | "RESULT"
  | "CONSENT"
  | "CONTRACT"
  | "RECEIPT"
  | "OTHER";

export type PatientDocument = {
  id: string;
  patientId: string;
  appointmentId: string | null;
  // The list returns rendered conclusions too.
  type: UploadableDocumentType | "CONCLUSION";
  title: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
  /** CD-06: who put it in the chart. */
  source: DocumentSourceValue;
  /** Set on a signed consent/contract; such a row is a legal record (CD-09). */
  signedAt: string | null;
  /** Voided by ADMIN with a reason: kept, never counted as signed (CD-09). */
  voidedAt: string | null;
  voidReason: string | null;
  visitNoteId: string | null;
  referralId: string | null;
  /** Per-patient sequence: `#1` is the oldest, `#N` the newest upload. */
  seq: number;
};

/**
 * The stored `fileUrl` is either the raw MinIO URL (private bucket → direct
 * GET fails with AccessDenied) or our proxy URL. The streaming route at
 * `/api/crm/documents/file?key=…` is the only path with tenant scoping +
 * the docker-internal MinIO endpoint, so route every persisted file through
 * it. The parsing is shared with the server (CD-02), so the two cannot
 * disagree.
 */
export function documentDownloadHref(fileUrl: string): string {
  // Anything not safe to navigate to (CD-08) opens a blank page instead.
  return documentHref(fileUrl) ?? "about:blank";
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
  type: UploadableDocumentType;
  title: string;
  fileUrl: string;
  /** Receipt from the upload route; required for a stored file (CD-08). */
  uploadToken?: string | null;
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
        // CD-09: a conclusion or a signed consent is a legal record.
        if (res.status === 409) {
          throw new Error("LOCKED");
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

/**
 * ADMIN voids a signed record filed by mistake (CD-09), with a reason. The
 * row stays in the card, marked voided; the patient's Mini App drops it.
 */
export function useVoidDocument(patientId: string) {
  const qc = useQueryClient();
  return useMutation<PatientDocument, Error, { documentId: string; reason: string }>({
    mutationFn: async ({ documentId, reason }) => {
      const res = await fetch(
        `/api/crm/documents/${encodeURIComponent(documentId)}/void`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PatientDocument;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patientId, "documents"] });
      qc.invalidateQueries({ queryKey: ["documents", "list"] });
    },
  });
}

/**
 * The patient's unsigned clinic consents and contracts, for the signature
 * pad's «к какому документу» choice (CD-05). Same filter as the library's
 * «ожидают подписи».
 */
export function usePendingConsents(patientId: string, enabled: boolean) {
  return useQuery<PatientDocument[], Error>({
    queryKey: ["patient", patientId, "documents", "pending-signature"],
    enabled,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        patientId,
        pendingSignature: "true",
        limit: "50",
      });
      const res = await fetch(`/api/crm/documents?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as DocumentsListResponse).rows;
    },
    staleTime: 15_000,
  });
}

export type SaveSignatureInput = {
  canvas: SignatureCanvas;
  title: string;
  fileName: string;
  signsDocumentId: string | null;
};

/** Error of a failed signature save; `reason` is the API's machine reason. */
export type SaveSignatureError = Error & { reason?: string };

/**
 * Signature pad save (CD-05): PNG through the upload route, then the
 * document: a signed consent when it signs one of the patient's pending
 * consents, an unsigned «Прочее» otherwise. Toasts are the caller's: it
 * knows the dialog's wording.
 */
export function useSaveSignature(patientId: string) {
  const qc = useQueryClient();
  return useMutation<void, SaveSignatureError, SaveSignatureInput>({
    mutationFn: (input) =>
      saveSignature({
        canvas: input.canvas,
        patientId,
        title: input.title,
        fileName: input.fileName,
        signsDocumentId: input.signsDocumentId,
        upload: (file) => uploadDocumentFile(file, patientId),
        discardUpload: (file) =>
          discardDocumentUpload(file.fileUrl, file.uploadToken),
        createDocument: async (doc: SignatureDocumentInput) => {
          const res = await fetch(`/api/crm/documents`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(doc),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => null)) as {
              error?: string;
              reason?: string;
            } | null;
            throw Object.assign(new Error(j?.error ?? `HTTP ${res.status}`), {
              reason: j?.reason,
            });
          }
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patientId, "documents"] });
      qc.invalidateQueries({ queryKey: ["documents", "list"] });
    },
  });
}
