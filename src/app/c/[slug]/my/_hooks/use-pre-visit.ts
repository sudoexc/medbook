"use client";

/**
 * Phase 16 Wave 2 — Pre-visit questionnaire data hooks.
 *
 * Wraps GET/POST `/api/miniapp/pre-visit/[appointmentId]` with React Query
 * so the form page can render saved answers, optimistically swap to the
 * "submitted" state, and re-fetch on retry.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PreVisitData } from "@/lib/patient-experience/pre-visit";
import { useMiniAppFetch } from "./use-miniapp-api";

export type PreVisitGetResponse = {
  appointment: {
    id: string;
    date: string;
    status: string;
    doctor: { nameRu: string; nameUz: string };
  };
  submittedAt: string | null;
  data: PreVisitData;
};

export function usePreVisit(
  appointmentId: string,
  onBehalfOf: string | null = null,
) {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<PreVisitGetResponse>({
    queryKey: [
      "miniapp",
      "pre-visit",
      clinicSlug,
      appointmentId,
      onBehalfOf ?? "self",
    ],
    queryFn: async () => {
      const sp: Record<string, string> = {};
      if (onBehalfOf) sp.onBehalfOf = onBehalfOf;
      return request<PreVisitGetResponse>(
        `/api/miniapp/pre-visit/${encodeURIComponent(appointmentId)}`,
        { searchParams: sp },
      );
    },
    enabled: appointmentId.length > 0,
  });
}

export type PreVisitSubmitInput = {
  complaints: string;
  allergies: string[];
  medications: string[];
  notes: string;
};

export function useSubmitPreVisit(
  appointmentId: string,
  onBehalfOf: string | null = null,
) {
  const { request, clinicSlug } = useMiniAppFetch();
  const qc = useQueryClient();
  return useMutation<
    { ok: true; submittedAt: string },
    Error,
    PreVisitSubmitInput
  >({
    mutationFn: async (input) => {
      const sp: Record<string, string> = {};
      if (onBehalfOf) sp.onBehalfOf = onBehalfOf;
      return request<{ ok: true; submittedAt: string }>(
        `/api/miniapp/pre-visit/${encodeURIComponent(appointmentId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          searchParams: sp,
        },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["miniapp", "pre-visit", clinicSlug, appointmentId],
      });
    },
  });
}
