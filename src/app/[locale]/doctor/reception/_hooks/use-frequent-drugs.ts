"use client";

import { useQuery } from "@tanstack/react-query";

export type FrequentDrugRow = {
  label: string;
  count: number;
  drugId: string | null;
  lastDose: string | null;
};

export function frequentDrugsKey() {
  return ["doctor", "me", "frequent-drugs"] as const;
}

/**
 * The doctor's own most-prescribed drugs, newest window first.
 *
 * Deliberately cached for the session: the list shifts over weeks, not during
 * a consultation, and re-fetching it on every visit screen mount would add
 * latency to the one screen that must feel instant.
 */
export function useFrequentDrugs(limit = 12) {
  return useQuery<FrequentDrugRow[], Error>({
    queryKey: [...frequentDrugsKey(), limit],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/doctors/me/frequent-drugs?limit=${limit}`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows?: FrequentDrugRow[] };
      return j.rows ?? [];
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
}
