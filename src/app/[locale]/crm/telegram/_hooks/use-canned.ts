"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type CannedLang = "RU" | "UZ";

export type CannedResponse = {
  id: string;
  title: string;
  body: string;
  lang: CannedLang;
  sortOrder: number;
  createdAt: string;
};

const cannedKey = ["canned-responses"] as const;

export function useCannedResponses(enabled: boolean) {
  return useQuery<{ rows: CannedResponse[] }>({
    queryKey: cannedKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/canned-responses", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      return (await res.json()) as { rows: CannedResponse[] };
    },
    enabled,
    staleTime: 60_000,
  });
}

export type CannedInput = {
  title: string;
  body: string;
  lang: CannedLang;
};

export function useCreateCanned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CannedInput): Promise<CannedResponse> => {
      const res = await fetch("/api/crm/canned-responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Create failed: ${res.status}`);
      }
      return (await res.json()) as CannedResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cannedKey });
    },
  });
}

export function useUpdateCanned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: { id: string } & Partial<CannedInput>): Promise<CannedResponse> => {
      const res = await fetch(`/api/crm/canned-responses/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Update failed: ${res.status}`);
      }
      return (await res.json()) as CannedResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cannedKey });
    },
  });
}

export function useDeleteCanned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(`/api/crm/canned-responses/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cannedKey });
    },
  });
}
