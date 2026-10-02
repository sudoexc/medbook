"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchAllAppointmentPages } from "@/lib/appointments/fetch-all-pages";
import { tashkentDayWindow, tashkentToday } from "@/lib/tashkent-time";

export type QueueAppointment = {
  id: string;
  date: string;
  endDate: string;
  durationMin: number;
  status:
    | "BOOKED"
    // Phone bookings arrive CONFIRMED (DC-05); the type used to pretend
    // the status could not occur.
    | "CONFIRMED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "CANCELLED"
    | "NO_SHOW"
    | "SKIPPED";
  startedAt: string | null;
  /**
   * Two-lanes fields (docs/TZ-two-lanes.md) — the API returns raw rows, so
   * these come through untouched. `channel === "WALKIN"` puts the row in
   * the live lane; the rest order it FIFO via the shared `compareQueue`.
   */
  channel: string;
  queuedAt: string | null;
  /** Row creation; for a walk-in, the moment the patient arrived (Q-23). */
  createdAt?: string | null;
  queuePriority: number;
  ticketSeq: number | null;
  queueOrder: number | null;
  patient: {
    id: string;
    fullName: string;
    phone: string;
    photoUrl: string | null;
  };
  doctor: {
    id: string;
    nameRu: string | null;
    nameUz: string | null;
    photoUrl: string | null;
    color: string | null;
    /** Letter in front of this doctor's tickets («A-005»), see ticketNumberFor. */
    ticketPrefix: string | null;
  };
  primaryService: { id: string; nameRu: string | null; nameUz: string | null } | null;
  cabinet: { id: string; number: string | null } | null;
};

/**
 * Today's queue, every page of it. The first cut read one page of 50 rows
 * (all statuses, oldest first) and never asked for the next one, so on a busy
 * day the evening IN_PROGRESS visit sat on page two and the reception screen
 * reported no active patient (audit VW-28). Paging through the whole day is
 * cheap: one doctor rarely has more than a couple of hundred rows.
 */
export async function fetchDoctorQueue(
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; today?: string } = {},
): Promise<QueueAppointment[]> {
  // The clinic day, not the browser's: a laptop with a wrong time zone would
  // otherwise ask for a window shifted by hours.
  const { from, to } = tashkentDayWindow(opts.today ?? tashkentToday());
  const { rows } = await fetchAllAppointmentPages<QueueAppointment>(
    {
      // The API pins a doctor caller to his own rows; no doctorId needed.
      from: from.toISOString(),
      to: to.toISOString(),
      sort: "date",
      dir: "asc",
    },
    { signal: opts.signal, fetchImpl: opts.fetchImpl },
  );
  return rows;
}

export const doctorQueueKey = ["doctor", "reception", "queue"] as const;

export function useDoctorQueue() {
  return useQuery<QueueAppointment[], Error>({
    queryKey: doctorQueueKey,
    queryFn: ({ signal }) => fetchDoctorQueue({ signal }),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}
