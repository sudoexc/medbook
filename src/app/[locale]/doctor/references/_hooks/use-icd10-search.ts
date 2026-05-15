"use client";

import { useQuery } from "@tanstack/react-query";

import type { Icd10Entry } from "@/server/icd10/data";

type Response = { rows: Icd10Entry[] };

export function useIcd10Search(q: string) {
  const trimmed = q.trim();
  return useQuery<Icd10Entry[], Error>({
    queryKey: ["doctor", "me", "icd10", "search", trimmed.toLowerCase()],
    queryFn: async ({ signal }) => {
      const url = new URL("/api/crm/icd10/search", window.location.origin);
      url.searchParams.set("q", trimmed);
      url.searchParams.set("limit", "50");
      const res = await fetch(url.toString(), {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`icd10 search: ${res.status}`);
      const j = (await res.json()) as Response;
      return j.rows;
    },
    enabled: trimmed.length >= 2,
    staleTime: 60_000,
  });
}
