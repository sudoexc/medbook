"use client";

import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

export type DoctorSidebarStats = {
  todayBadge: number;
  unreadMessages: number;
  loadPercent: number;
  todayCount: number;
};

export const doctorSidebarStatsKey = ["doctor", "me", "sidebar-stats"] as const;

/**
 * Subscribes to four event types that can change any of the four numbers:
 *   - appointment.*  → today's appointment count / badge / load percent
 *   - tg.message.new → unread inbox counter
 * Debouncing is handled inside `useLiveQueryInvalidation` (400ms coalesce).
 */
export function useDoctorSidebarStats() {
  const query = useQuery<DoctorSidebarStats>({
    queryKey: doctorSidebarStatsKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/sidebar-stats", {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        throw new Error(`sidebar-stats: ${res.status}`);
      }
      return (await res.json()) as DoctorSidebarStats;
    },
    staleTime: 30_000,
  });

  useLiveQueryInvalidation({
    events: [
      "appointment.created",
      "appointment.updated",
      "appointment.statusChanged",
      "appointment.cancelled",
      "appointment.moved",
      "tg.message.new",
      "tg.conversation.updated",
    ],
    queryKey: doctorSidebarStatsKey,
  });

  return query;
}
