"use client";

import { useQuery } from "@tanstack/react-query";

export type DoctorCaseStats = {
  doctorId: string;
  /** OPEN cases this doctor is primary for. */
  openCases: number;
  /** RESOLVED cases this doctor is primary for, closed in the last 30 days. */
  resolvedLast30d: number;
  /** % of last-90d appointments that are visit #2+ in their case (1 decimal). */
  repeatRatePct: number;
  /** Average (closedAt - openedAt) in whole days for RESOLVED cases. */
  avgDurationDays: number;
};

/**
 * Doctor-profile "Cases" card data. Single round-trip — see
 * /api/crm/doctors/[id]/case-stats which fans out 4 small queries in
 * parallel server-side.
 */
export function useDoctorCaseStats(doctorId: string) {
  return useQuery<DoctorCaseStats, Error>({
    queryKey: ["doctor", doctorId, "case-stats"],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/doctors/${doctorId}/case-stats`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DoctorCaseStats;
    },
    staleTime: 60_000,
  });
}
