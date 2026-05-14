"use client";

import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

import type { ScheduleEntry, DaySummary } from "./use-doctor-today";

export type DoctorSchedule = {
  date: string;
  entries: ScheduleEntry[];
  summary: DaySummary;
};

export const doctorScheduleKey = (date: string) =>
  ["doctor", "me", "schedule", date] as const;

/**
 * Schedule slice for an arbitrary date. The /my-day dashboard uses this
 * hook so the schedule card can page through past/future days without
 * dragging the whole `/today` aggregate (which only makes sense for the
 * current day) along for the ride.
 *
 * SSE invalidates the entire `["doctor","me","schedule"]` prefix on any
 * appointment.* event — cheap because only the active date's query is
 * currently mounted at a time, and `refetchType:"active"` skips the rest.
 */
export function useDoctorSchedule(date: string) {
  const query = useQuery<DoctorSchedule>({
    queryKey: doctorScheduleKey(date),
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/doctors/me/schedule?date=${encodeURIComponent(date)}`,
        { credentials: "include", signal },
      );
      if (!res.ok) {
        throw new Error(`doctor-schedule: ${res.status}`);
      }
      return (await res.json()) as DoctorSchedule;
    },
    staleTime: 15_000,
  });

  useLiveQueryInvalidation({
    events: [
      "appointment.created",
      "appointment.updated",
      "appointment.statusChanged",
      "appointment.cancelled",
      "appointment.moved",
    ],
    queryKey: ["doctor", "me", "schedule"],
  });

  return query;
}
