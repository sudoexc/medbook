"use client";

import { useQuery } from "@tanstack/react-query";

import { tashkentDayWindow, tashkentToday } from "@/lib/tashkent-time";
import { pickNextAppointment } from "@/lib/calls/caller-context";

/**
 * The caller's nearest visit still ahead (audit CM-11), asked of the
 * appointments list from the start of today's clinic day, oldest first. The
 * card's own 10 rows are the newest by date, so the nearest visit was not
 * among them whenever the patient had later bookings.
 */
export type NextAppointment = {
  id: string;
  date: string;
  time: string | null;
  status: string;
  doctor: { id: string; nameRu: string; nameUz: string } | null;
  primaryService: { id: string; nameRu: string; nameUz: string } | null;
};

/** Enough rows to step over today's finished or cancelled visits. */
const LOOKAHEAD = 20;

export function useNextAppointment(patientId: string | null) {
  return useQuery<NextAppointment | null, Error>({
    queryKey: ["call-center", "next-appointment", patientId],
    enabled: Boolean(patientId),
    queryFn: async ({ signal }) => {
      if (!patientId) return null;
      const { from } = tashkentDayWindow(tashkentToday());
      const sp = new URLSearchParams({
        patientId,
        from: from.toISOString(),
        sort: "date",
        dir: "asc",
        limit: String(LOOKAHEAD),
      });
      const res = await fetch(`/api/crm/appointments?${sp.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: NextAppointment[] };
      return pickNextAppointment(data.rows ?? [], from);
    },
    staleTime: 30_000,
  });
}
