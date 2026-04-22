"use client";

import { useQuery } from "@tanstack/react-query";
import { useMiniAppFetch } from "./use-miniapp-api";

export type MiniAppDocument = {
  id: string;
  type: string;
  title: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

export function useDocuments() {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppDocument[]>({
    queryKey: ["miniapp", "documents", clinicSlug],
    queryFn: async () => {
      const body = await request<{ documents: MiniAppDocument[] }>(
        "/api/miniapp/documents",
      );
      return body.documents;
    },
  });
}
