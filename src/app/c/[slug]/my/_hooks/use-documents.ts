"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  miniAppFetchHeaders,
  useMiniAppAuth,
} from "../_components/miniapp-auth-provider";
import { useMiniAppFetch } from "./use-miniapp-api";

export type MiniAppDocument = {
  id: string;
  type: string;
  title: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  /** Per-patient sequence: `#1` is the oldest, `#N` the newest upload. */
  seq: number;
};

export function useDocuments() {
  const { request, clinicSlug } = useMiniAppFetch();
  const { state } = useMiniAppAuth();
  // Wait until the auth provider has finished the init-data exchange —
  // otherwise the very first render fires this fetch with an empty
  // `x-telegram-init-data` header (SDK still booting), the server returns
  // 401 `missing_init_data`, and the docs page renders empty until the
  // user retries.
  return useQuery<MiniAppDocument[]>({
    queryKey: ["miniapp", "documents", clinicSlug],
    enabled: state.status === "ready",
    queryFn: async ({ signal }) => {
      const body = await request<{ documents: MiniAppDocument[] }>(
        "/api/miniapp/documents",
      );
      return body.documents;
    },
  });
}

export type UploadDocumentInput = {
  file: File;
  title?: string;
  type?: string;
};

export type UploadDocumentError = Error & {
  status?: number;
  data?: { reason?: string; maxBytes?: number; mime?: string };
};

/**
 * Upload a single document (image or PDF) from the patient's device. Uses
 * raw `fetch` rather than `useMiniAppFetch.request` so the browser can set
 * the multipart boundary automatically — overriding Content-Type would
 * break the upload.
 */
export function useUploadDocument() {
  const { clinicSlug, initData, isTelegramContext } = useMiniAppAuth();
  const qc = useQueryClient();
  return useMutation<MiniAppDocument, UploadDocumentError, UploadDocumentInput>({
    mutationFn: async (input) => {
      const url = new URL("/api/miniapp/documents", window.location.origin);
      url.searchParams.set("clinicSlug", clinicSlug);
      const form = new FormData();
      form.append("file", input.file);
      if (input.title) form.append("title", input.title);
      if (input.type) form.append("type", input.type);
      // `miniAppFetchHeaders` defaults to `content-type: application/json`,
      // which would clobber the `multipart/form-data; boundary=…` that fetch
      // sets automatically for a FormData body — resulting in `formData()`
      // throwing on the server and a 400 InvalidMultipart. Strip it so the
      // browser owns Content-Type for this request.
      const headers = {
        ...(miniAppFetchHeaders(initData, isTelegramContext) as Record<
          string,
          string
        >),
      };
      delete headers["content-type"];
      const res = await fetch(url.toString(), {
        method: "POST",
        body: form,
        headers,
        cache: "no-store",
      });
      const isJson = res.headers
        .get("content-type")
        ?.includes("application/json");
      const body = isJson ? await res.json() : null;
      if (!res.ok) {
        const message = body?.reason ?? body?.error ?? `HTTP ${res.status}`;
        const err = new Error(message) as UploadDocumentError;
        err.status = res.status;
        err.data = body;
        throw err;
      }
      return body.document as MiniAppDocument;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["miniapp", "documents", clinicSlug] });
    },
  });
}
