"use client";

/**
 * P1.2 — patient lab-results hook.
 *
 * GET `/api/miniapp/labs` → the active patient's REVIEWED lab results. The
 * query key `["miniapp","labs",clinicSlug]` is what `lab.result.reviewed`
 * invalidates (see `use-miniapp-live-events`), so a doctor flipping a result
 * to REVIEWED refreshes this screen live without a manual pull.
 */
import { useQuery } from "@tanstack/react-query";

import { useMiniAppAuth } from "../_components/miniapp-auth-provider";
import { useMiniAppFetch } from "./use-miniapp-api";

export type LabFlag = "NORMAL" | "LOW" | "HIGH" | "CRITICAL";

export type MiniAppLabResult = {
  id: string;
  testName: string;
  value: string;
  unit: string | null;
  refRange: string | null;
  flag: LabFlag | null;
  reviewedAt: string | null;
  doctorName: string;
  attachmentUrl: string | null;
};

export function useLabs() {
  const { request, clinicSlug } = useMiniAppFetch();
  const { state } = useMiniAppAuth();
  // Wait for the init-data exchange (same rationale as `useDocuments`): firing
  // before the SDK boots sends an empty init-data header and 401s.
  return useQuery<MiniAppLabResult[]>({
    queryKey: ["miniapp", "labs", clinicSlug],
    enabled: state.status === "ready",
    queryFn: async () => {
      const body = await request<{ labs: MiniAppLabResult[] }>(
        "/api/miniapp/labs",
      );
      return body.labs;
    },
    staleTime: 30_000,
  });
}
