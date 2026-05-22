"use client";

import { useQuery } from "@tanstack/react-query";

export type ClinicalProtocolRow = {
  id: string;
  diagnosisCodePrefix: string;
  nameRu: string;
  nameUz: string | null;
  summaryRu: string | null;
  complaintsTemplate: string[];
  anamnesisTemplate: string[];
  examinationTemplate: string[];
  prescriptionsTemplate: string[];
  adviceTemplate: string[];
  recommendedLabs: string[];
  conclusionTemplateMd: string | null;
  sortOrder: number;
  active: boolean;
};

async function fetchProtocols(code: string): Promise<ClinicalProtocolRow[]> {
  if (!code) return [];
  const url = `/api/crm/catalogs/protocols?code=${encodeURIComponent(code)}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return [];
  const data = (await res.json()) as { rows: ClinicalProtocolRow[] };
  return data.rows ?? [];
}

export function useClinicalProtocols(diagnosisCode: string | null | undefined) {
  return useQuery({
    queryKey: ["clinical-protocols", diagnosisCode ?? ""],
    queryFn: () => fetchProtocols(diagnosisCode ?? ""),
    enabled: !!diagnosisCode,
    staleTime: 5 * 60_000,
  });
}
