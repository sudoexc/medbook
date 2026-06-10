"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { VisitPrescriptionDraft } from "./use-visit-note";

// Stored JSON shape of one prescriptionItems entry — zod-parsed input where
// optional keys may be absent (JSON drops `undefined`), hence the Partial.
export type ProtocolPrescriptionItem = Partial<VisitPrescriptionDraft> &
  Pick<VisitPrescriptionDraft, "displayName" | "dose">;

export type ClinicalProtocolRow = {
  id: string;
  clinicId: string | null;
  doctorId: string | null;
  diagnosisCodePrefix: string;
  nameRu: string;
  nameUz: string | null;
  summaryRu: string | null;
  complaintsTemplate: string[];
  anamnesisTemplate: string[];
  examinationTemplate: string[];
  prescriptionsTemplate: string[];
  prescriptionItems: ProtocolPrescriptionItem[] | null;
  adviceTemplate: string[];
  recommendedLabs: string[];
  conclusionTemplateMd: string | null;
  guideCode: string | null;
  followUpDays: number | null;
  sortOrder: number;
  active: boolean;
};

/** Normalize a stored protocol item back into a full visit-note draft. */
export function protocolItemToDraft(
  item: ProtocolPrescriptionItem,
): VisitPrescriptionDraft {
  return {
    drugId: item.drugId ?? null,
    displayName: item.displayName,
    form: item.form ?? null,
    strength: item.strength ?? null,
    dose: item.dose,
    timesOfDay: item.timesOfDay ?? [],
    mealRelation: item.mealRelation ?? "NO_MATTER",
    durationDays: item.durationDays ?? null,
    instructionRu: item.instructionRu ?? null,
    instructionUz: item.instructionUz ?? null,
    remindPatient: item.remindPatient ?? true,
  };
}

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

// Ф3 — «сохранить приём как протокол»: POST creates a personal protocol
// (the server derives scope from the role).
export type CreateProtocolInput = {
  diagnosisCodePrefix: string;
  nameRu: string;
  complaintsTemplate: string[];
  anamnesisTemplate: string[];
  examinationTemplate: string[];
  prescriptionsTemplate: string[];
  prescriptionItems: VisitPrescriptionDraft[];
  adviceTemplate: string[];
};

export function useCreateProtocol() {
  const qc = useQueryClient();
  return useMutation<ClinicalProtocolRow, Error, CreateProtocolInput>({
    mutationFn: async (input) => {
      const res = await fetch("/api/crm/protocols", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`protocols ${res.status}`);
      return (await res.json()) as ClinicalProtocolRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinical-protocols"] });
    },
  });
}
