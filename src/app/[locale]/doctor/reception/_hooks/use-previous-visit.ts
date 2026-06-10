"use client";

/**
 * Ф7 — последний FINALIZED визит пациента у этого врача.
 *
 * Один запрос питает сразу три фичи сессии: кнопку «Продолжить от прошлого
 * визита», сегмент динамики в шапке и (на сервере) дифф лечения. Карточка
 * шапки и панель полей зовут хук независимо — react-query дедуплицирует.
 */
import { useQuery } from "@tanstack/react-query";

import type { VisitPrescriptionRow } from "./use-visit-note";

export type PreviousVisitRow = {
  id: string;
  finalizedAt: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  complaints: string[];
  anamnesis: string[];
  dynamics: "IMPROVED" | "STABLE" | "WORSE" | null;
  visitPrescriptions: VisitPrescriptionRow[];
};

export const previousVisitKey = (noteId: string | null) =>
  ["doctor", "reception", "previous-visit", noteId ?? ""] as const;

export function usePreviousVisit(noteId: string | null) {
  return useQuery<PreviousVisitRow | null>({
    queryKey: previousVisitKey(noteId),
    enabled: !!noteId,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/visit-notes/${noteId}/previous`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`previous-visit ${res.status}`);
      const json = (await res.json()) as { previous: PreviousVisitRow | null };
      return json.previous;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
