"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Appointments query shape used by the doctors list right rail and the
 * per-card load/revenue aggregation.
 *
 * We lean on `GET /api/crm/appointments?from=&to=` and aggregate client-side
 * because there is no dedicated `doctors/stats` endpoint in Phase 1.
 */
export type DoctorAggregateAppointment = {
  id: string;
  date: string;
  status:
    | "BOOKED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  priceFinal: number | null;
  doctor: { id: string; nameRu: string; nameUz: string };
};

export type DoctorAgg = {
  doctorId: string;
  total: number;
  completed: number;
  noShow: number;
  revenue: number;
  todayCount: number;
};

export function aggregateByDoctor(
  rows: DoctorAggregateAppointment[],
): Map<string, DoctorAgg> {
  const acc = new Map<string, DoctorAgg>();
  const todayKey = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    const id = r.doctor.id;
    const prev = acc.get(id) ?? {
      doctorId: id,
      total: 0,
      completed: 0,
      noShow: 0,
      revenue: 0,
      todayCount: 0,
    };
    prev.total += 1;
    if (r.status === "COMPLETED") {
      prev.completed += 1;
      prev.revenue += r.priceFinal ?? 0;
    }
    if (r.status === "NO_SHOW") prev.noShow += 1;
    if (r.date.slice(0, 10) === todayKey) prev.todayCount += 1;
    acc.set(id, prev);
  }
  return acc;
}

export function useDoctorsAppointmentsAgg(range: {
  from: string;
  to: string;
}) {
  return useQuery<DoctorAggregateAppointment[], Error>({
    queryKey: ["doctors", "appointments-agg", range],
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({
        from: range.from,
        to: range.to,
        limit: "500",
      });
      const res = await fetch(`/api/crm/appointments?${qs.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as {
        rows: DoctorAggregateAppointment[];
        nextCursor: string | null;
      };
      return j.rows;
    },
    staleTime: 60_000,
  });
}
