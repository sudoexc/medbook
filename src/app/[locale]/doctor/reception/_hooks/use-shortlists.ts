"use client";

/**
 * «Мои частые» — what opens on tapping the diagnosis or drug field with
 * nothing typed (see /api/crm/doctors/me/{diagnosis,drug}-shortlist), plus
 * the one-tap «add this drug to the clinic's base» mutation.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { DrugSearchHit } from "./use-drug-search";

export type DiagnosisShortItem = {
  code: string | null;
  name: string;
  count: number;
  pinned: boolean;
};

export type DrugShortItem = {
  key: string;
  drugId: string | null;
  label: string;
  count: number;
  lastDose: string | null;
  pinned: boolean;
  strengths: string[];
  drug: DrugSearchHit | null;
};

export const diagnosisShortlistKey = ["doctor", "reception", "dx-shortlist"] as const;
export const drugShortlistKey = ["doctor", "reception", "rx-shortlist"] as const;

export function useDiagnosisShortlist(enabled = true) {
  return useQuery<DiagnosisShortItem[]>({
    queryKey: diagnosisShortlistKey,
    enabled,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/diagnosis-shortlist", {
        credentials: "include",
        signal,
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { rows?: DiagnosisShortItem[] };
      return data.rows ?? [];
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useDrugShortlist(enabled = true) {
  return useQuery<{ mine: DrugShortItem[]; clinic: DrugShortItem[] }>({
    queryKey: drugShortlistKey,
    enabled,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/drug-shortlist", {
        credentials: "include",
        signal,
      });
      if (!res.ok) return { mine: [], clinic: [] };
      const data = (await res.json()) as {
        mine?: DrugShortItem[];
        clinic?: DrugShortItem[];
      };
      return { mine: data.mine ?? [], clinic: data.clinic ?? [] };
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** The add was refused on purpose (e.g. the ADMIN hid that drug). */
export class AddClinicDrugError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(`add drug ${status}${reason ? ` (${reason})` : ""}`);
  }
}

/**
 * Add a drug the catalog lacks to the clinic's base — visible to every
 * doctor from then on. Returns the existing row when the name is already
 * there under that exact spelling.
 */
export function useAddClinicDrug() {
  const qc = useQueryClient();
  return useMutation<{ drug: DrugSearchHit; created: boolean }, Error, string>({
    mutationFn: async (name) => {
      const res = await fetch("/api/crm/catalogs/drugs/custom", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        let reason: string | null = null;
        try {
          reason = ((await res.json()) as { reason?: string }).reason ?? null;
        } catch {
          reason = null;
        }
        throw new AddClinicDrugError(res.status, reason);
      }
      const data = (await res.json()) as {
        drug: DrugSearchHit | null;
        created: boolean;
      };
      if (!data.drug) throw new Error("add drug: empty");
      return { drug: data.drug, created: data.created };
    },
    onSuccess: () => {
      // The new name must be findable at once, here and in the reference.
      qc.invalidateQueries({ queryKey: ["doctor", "reception", "drug-search"] });
      qc.invalidateQueries({ queryKey: ["doctor", "references"] });
    },
  });
}
