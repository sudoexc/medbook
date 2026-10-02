"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

import { eventTargetsDoctor } from "../my-day/_hooks/use-doctor-today";

export type DoctorSidebarStats = {
  doctorId: string;
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
  const qc = useQueryClient();
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
    // DC-24 — the sidebar sits on every doctor page, so without this every
    // appointment event in the clinic refetched every doctor's stats (three
    // queries each). Same per-doctor filter as «Мой день»; Telegram events
    // carry no doctorId and still pass, as do events before the first load.
    shouldInvalidate: (event) =>
      eventTargetsDoctor(
        event,
        qc.getQueryData<DoctorSidebarStats>(doctorSidebarStatsKey)?.doctorId,
      ),
  });

  return query;
}
