"use client";

import { useQuery } from "@tanstack/react-query";

import type { DrugDetail } from "../../_components/drug-detail";

type Response = { rows: DrugDetail[]; total: number };

// The full catalog is ~160 rows, so we fetch it once (limit=200 covers it)
// and filter/group client-side — instant search with no per-keystroke round
// trip, unlike the ICD-10 browser which queries the server.
export function useDrugCatalog() {
  return useQuery<DrugDetail[], Error>({
    queryKey: ["doctor", "references", "drug-catalog"],
    queryFn: async ({ signal }) => {
      const url = new URL("/api/crm/catalogs/drugs", window.location.origin);
      url.searchParams.set("limit", "200");
      const res = await fetch(url.toString(), {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`drug catalog: ${res.status}`);
      const j = (await res.json()) as Response;
      return j.rows;
    },
    staleTime: 60_000,
  });
}
