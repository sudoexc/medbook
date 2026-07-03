"use client";

import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";

export type QueueAppointment = {
  id: string;
  date: string;
  endDate: string;
  durationMin: number;
  status:
    | "BOOKED"
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
  };
  primaryService: { id: string; nameRu: string | null; nameUz: string | null } | null;
  cabinet: { id: string; number: string | null } | null;
};

type AppointmentsResponse = {
  rows: QueueAppointment[];
  total: number;
  nextCursor: string | null;
  tally: Record<string, number>;
};

function todayBounds(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

export const doctorQueueKey = ["doctor", "reception", "queue"] as const;

export function useDoctorQueue() {
  return useInfiniteQuery<
    AppointmentsResponse,
    Error,
    InfiniteData<AppointmentsResponse>,
    typeof doctorQueueKey,
    string | null
  >({
    queryKey: doctorQueueKey,
    initialPageParam: null,
    queryFn: async ({ pageParam, signal }) => {
      const { from, to } = todayBounds();
      const params = new URLSearchParams({
        doctorId: "me-implicit",
        from,
        to,
        sort: "date",
        dir: "asc",
        limit: "50",
      });
      params.delete("doctorId");
      if (pageParam) params.set("cursor", pageParam);

      const res = await fetch(`/api/crm/appointments?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`appointments ${res.status}`);
      return (await res.json()) as AppointmentsResponse;
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function flattenQueue(
  data: InfiniteData<AppointmentsResponse> | undefined,
): QueueAppointment[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.rows);
}
