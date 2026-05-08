"use client";

/**
 * Phase 16 Wave 2 — Post-visit NPS hooks.
 *
 * GET `/api/miniapp/nps/[appointmentId]` → appointment context + existing
 * review row (so the deeplink can resolve into a "thank you" state on
 * resubmit instead of an editable form).
 *
 * POST → score (1..10) + optional comment. Server returns 409 with
 * `reason: "already_submitted"` if the patient already rated this visit;
 * the React Query mutation surfaces that as a typed Error.data field.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

export type NpsGetResponse = {
  appointment: {
    id: string;
    date: string;
    status: string;
    completedAt: string | null;
    doctor: { id: string; nameRu: string; nameUz: string };
  };
  review: {
    id: string;
    score: number;
    comment: string | null;
    respondedAt: string;
  } | null;
};

export function useNps(
  appointmentId: string,
  onBehalfOf: string | null = null,
) {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<NpsGetResponse>({
    queryKey: [
      "miniapp",
      "nps",
      clinicSlug,
      appointmentId,
      onBehalfOf ?? "self",
    ],
    queryFn: async () => {
      const sp: Record<string, string> = {};
      if (onBehalfOf) sp.onBehalfOf = onBehalfOf;
      return request<NpsGetResponse>(
        `/api/miniapp/nps/${encodeURIComponent(appointmentId)}`,
        { searchParams: sp },
      );
    },
    enabled: appointmentId.length > 0,
  });
}

export type NpsSubmitInput = { score: number; comment?: string };
export type NpsSubmitResponse = {
  ok: true;
  reviewId: string;
  score: number;
  adminAlerted: boolean;
  actionId: string | null;
};

export function useSubmitNps(
  appointmentId: string,
  onBehalfOf: string | null = null,
) {
  const { request, clinicSlug } = useMiniAppFetch();
  const qc = useQueryClient();
  return useMutation<NpsSubmitResponse, Error, NpsSubmitInput>({
    mutationFn: async (input) => {
      const sp: Record<string, string> = {};
      if (onBehalfOf) sp.onBehalfOf = onBehalfOf;
      return request<NpsSubmitResponse>(
        `/api/miniapp/nps/${encodeURIComponent(appointmentId)}`,
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
        queryKey: ["miniapp", "nps", clinicSlug, appointmentId],
      });
    },
  });
}
