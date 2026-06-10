"use client";

import { useQuery } from "@tanstack/react-query";

export type DiagnosisGuideRow = {
  id: string;
  clinicId: string | null;
  code: string;
  matchPrefix: string;
  titleRu: string;
  titleUz: string | null;
  whatToDoRu: string | null;
  whatToDoUz: string | null;
  careRu: string | null;
  careUz: string | null;
  lifestyleRu: string | null;
  lifestyleUz: string | null;
  redFlagsRu: string | null;
  redFlagsUz: string | null;
  adviceChips: string[];
  defaultFollowUpDays: number | null;
  sortOrder: number;
  active: boolean;
};

async function fetchGuides(icd: string): Promise<DiagnosisGuideRow[]> {
  if (!icd) return [];
  const url = `/api/crm/guides?icd=${encodeURIComponent(icd)}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return [];
  const data = (await res.json()) as { rows: DiagnosisGuideRow[] };
  return data.rows ?? [];
}

/**
 * Knowledge-base guide for the active diagnosis (Ф1). The route returns
 * matches sorted most-specific-first, so `.data?.[0]` is "the" guide.
 */
export function useDiagnosisGuide(diagnosisCode: string | null | undefined) {
  return useQuery({
    queryKey: ["doctor", "reception", "guides", diagnosisCode ?? ""],
    queryFn: () => fetchGuides(diagnosisCode ?? ""),
    enabled: !!diagnosisCode,
    staleTime: 5 * 60_000,
  });
}

/**
 * Locale-aware text picker: Uz column with Ru fallback (uz columns are
 * optional in the schema), Ru column verbatim otherwise.
 */
export function pickGuideText(
  locale: string,
  ru: string | null,
  uz: string | null,
): string | null {
  if (locale === "uz") return uz?.trim() || ru?.trim() || null;
  return ru?.trim() || null;
}
