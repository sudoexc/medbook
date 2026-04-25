"use client";

import { useQuery } from "@tanstack/react-query";

export type DoctorFinance = {
  doctorId: string;
  period: { from: string | null; to: string | null };
  revenue: number;
  appointments: number;
  salaryPercent: number;
  bonus: number;
};

/**
 * Phase 1 endpoint returns revenue + completed-appointments + bonus only.
 * Avg-check and no-show rate are derived client-side from
 * `/api/crm/appointments` in the same period. See `use-doctor-appointments`.
 */
export function useDoctorFinance(
  doctorId: string,
  range: { from: string; to: string },
) {
  return useQuery<DoctorFinance, Error>({
    queryKey: ["doctor", doctorId, "finance", range],
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      const res = await fetch(
        `/api/crm/doctors/${doctorId}/finance?${qs.toString()}`,
        {  credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DoctorFinance;
    },
    staleTime: 60_000,
  });
}
