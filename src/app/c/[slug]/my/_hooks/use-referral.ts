"use client";

/**
 * Phase 16 Wave 3 — Refer-a-friend Mini App hook.
 *
 * GET `/api/miniapp/referral` returns the patient's persistent code,
 * usage count, the clinic's current reward percent (snapshot), and the
 * pending/applied/expired reward history.
 *
 * Side-effect: the GET auto-creates the code on first call. The Mini App
 * does not need a separate POST — opening the screen is enough.
 */
import { useQuery } from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

export type ReferralPendingReward = {
  id: string;
  rewardPercent: number;
  expiresAt: string;
  friendName: string | null;
  createdAt: string;
};

export type ReferralAppliedReward = {
  id: string;
  rewardPercent: number;
  appliedAt: string | null;
  appliedAppointmentId: string | null;
  friendName: string | null;
};

export type ReferralResponse = {
  code: string;
  useCount: number;
  rewardPercent: number;
  clinicSlug: string;
  pendingRewards: ReferralPendingReward[];
  appliedRewards: ReferralAppliedReward[];
  expiredCount: number;
};

export function useReferral() {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<ReferralResponse>({
    queryKey: ["miniapp", "referral", clinicSlug],
    queryFn: () => request<ReferralResponse>("/api/miniapp/referral"),
    staleTime: 60_000,
  });
}
