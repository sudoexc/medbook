"use client";

import { useQuery } from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

/** Mirrors `TreatmentProgress` (server/services/treatment-plan). */
export type TreatmentPlanProgress = {
  done: number;
  /** Null without a doctor-set plan length: no «N из M», no bar. */
  total: number | null;
  nextVisitAt: string | null;
  progress: number | null;
  /** Only a RESOLVED case is «Лечение завершено». */
  completed: boolean;
  empty: boolean;
};

export type TreatmentPlanCase = {
  id: string;
  title: string;
  primaryComplaint: string | null;
  diagnosisText: string | null;
  openedAt: string;
  primaryDoctor: {
    id: string;
    nameRu: string;
    nameUz: string;
    photoUrl: string | null;
  } | null;
  progress: TreatmentPlanProgress;
  nextBooked: { id: string; date: string; time: string | null } | null;
};

export type TreatmentPlanResponse = {
  active: TreatmentPlanCase | null;
  more: number;
};

export function useTreatmentPlan(activePatientId?: string | null) {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<TreatmentPlanResponse>({
    queryKey: ["miniapp", "treatment-plan", clinicSlug, activePatientId ?? "self"],
    queryFn: async () => {
      const sp: Record<string, string> = {};
      if (activePatientId) sp.onBehalfOf = activePatientId;
      return request<TreatmentPlanResponse>("/api/miniapp/treatment-plan", {
        searchParams: sp,
      });
    },
  });
}
