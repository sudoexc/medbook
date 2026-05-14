"use client";

import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";

export type ConclusionRow = {
  id: string;
  status: "DRAFT" | "FINALIZED";
  startedAt: string | null;
  finalizedAt: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  updatedAt: string;
  patient: { id: string; fullName: string };
  appointment: { id: string; date: string; status: string };
};

type ListResponse = {
  rows: ConclusionRow[];
  nextCursor: string | null;
};

export type ConclusionsFilters = {
  query: string;
  status?: "FINALIZED" | "DRAFT";
};

export const conclusionsListKey = (filters: ConclusionsFilters) =>
  ["doctor", "conclusions", "list", filters] as const;

export function useConclusionsList(filters: ConclusionsFilters) {
  return useInfiniteQuery<
    ListResponse,
    Error,
    InfiniteData<ListResponse>,
    ReturnType<typeof conclusionsListKey>,
    string | null
  >({
    queryKey: conclusionsListKey(filters),
    initialPageParam: null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        status: filters.status ?? "FINALIZED",
        limit: "30",
      });
      if (filters.query.trim().length > 0) params.set("q", filters.query.trim());
      if (pageParam) params.set("cursor", pageParam);
      const res = await fetch(`/api/crm/visit-notes?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`visit-notes ${res.status}`);
      return (await res.json()) as ListResponse;
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
  });
}

export function flattenList(
  data: InfiniteData<ListResponse> | undefined,
): ConclusionRow[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.rows);
}
