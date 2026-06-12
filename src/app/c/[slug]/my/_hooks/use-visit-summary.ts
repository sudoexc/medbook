"use client";

import { useQuery } from "@tanstack/react-query";
import { useMiniAppFetch } from "./use-miniapp-api";

export type VisitSummary = {
  appointmentId: string;
  date: string;
  time: string | null;
  finalizedAt: string | null;
  documentNumber: string | null;
  diagnosisName: string | null;
  handoutMarkdown: string | null;
  doctor: {
    id: string;
    nameRu: string;
    nameUz: string;
    specializationRu: string;
    specializationUz: string;
  };
  followUpAt: string | null;
  conclusionUrl: string | null;
};

/**
 * Wave 3c — finalized visit summary («Что сказал врач»). `null` means the
 * doctor hasn't finalized the note yet — the screen shows a "готовится"
 * placeholder instead of an error.
 */
export function useVisitSummary(
  appointmentId: string,
  activePatientId?: string | null,
) {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<VisitSummary | null>({
    queryKey: [
      "miniapp",
      "visit-summary",
      clinicSlug,
      appointmentId,
      activePatientId ?? "self",
    ],
    queryFn: async () => {
      const body = await request<{ summary: VisitSummary | null }>(
        `/api/miniapp/visit-summary/${appointmentId}`,
        {
          searchParams: activePatientId
            ? { onBehalfOf: activePatientId }
            : undefined,
        },
      );
      return body.summary;
    },
    enabled: Boolean(appointmentId),
  });
}
