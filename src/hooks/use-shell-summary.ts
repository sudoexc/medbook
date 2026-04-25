"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Shape returned by `GET /api/crm/shell-summary`. Drives the donut/today
 * count in the sidebar and the channel badges in topbar+sidebar. The hook
 * is consumed everywhere the chrome lives, so it's deliberately a single
 * round-trip with cheap counts.
 */
export type ShellSummary = {
  today: {
    appointmentsCount: number;
    loadPercent: number;
  };
  unread: {
    calls: number;
    telegram: number;
    smsEmail: number;
    notifications: number;
  };
};

export const shellSummaryKey = ["crm", "shell-summary"] as const;

export function useShellSummary() {
  return useQuery<ShellSummary, Error>({
    queryKey: shellSummaryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/shell-summary", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ShellSummary;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
