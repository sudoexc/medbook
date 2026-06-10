"use client";

/**
 * Ф2 (TZ-smart-constructor) — drug catalog search for the prescription
 * constructor. Same debounce/top-12 pattern as useIcd10Search; hits the
 * DB-backed catalog (brand / INN / ATC ranked server-side).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";

export type DrugSearchHit = {
  id: string;
  inn: string;
  nameRu: string;
  nameUz: string | null;
  atcCode: string | null;
  category: string;
  forms: { form: string; strengths: string[] }[];
  defaultDosing: {
    adult?: string;
    pediatric?: string;
    renal?: string;
    elderly?: string;
  } | null;
  rxOnly: boolean;
  brands: { id: string; name: string; manufacturer: string | null }[];
};

async function fetchDrugRows(
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<DrugSearchHit[]> {
  const res = await fetch(`/api/crm/catalogs/drugs?${params.toString()}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error(`drugs ${res.status}`);
  const data = (await res.json()) as { rows: DrugSearchHit[] };
  return data.rows ?? [];
}

export function useDrugSearch(rawQuery: string) {
  const [debounced, setDebounced] = React.useState(rawQuery);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(rawQuery), 180);
    return () => clearTimeout(t);
  }, [rawQuery]);

  const q = debounced.trim();
  return useQuery<DrugSearchHit[]>({
    queryKey: ["doctor", "reception", "drug-search", q],
    enabled: q.length >= 2,
    queryFn: ({ signal }) =>
      fetchDrugRows(new URLSearchParams({ q, limit: "12" }), signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** «Часто назначают при {диагноз}» — drugs whose indications match the ICD code. */
export function useDrugSuggestions(diagnosisCode: string | null | undefined) {
  const code = diagnosisCode?.trim() ?? "";
  return useQuery<DrugSearchHit[]>({
    queryKey: ["doctor", "reception", "drug-suggest", code],
    enabled: code.length >= 3,
    queryFn: ({ signal }) =>
      fetchDrugRows(
        new URLSearchParams({ forDiagnosis: code, limit: "8" }),
        signal,
      ),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
