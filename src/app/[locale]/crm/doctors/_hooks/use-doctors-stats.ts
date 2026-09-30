"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchAllAppointmentPages } from "@/lib/appointments/fetch-all-pages";

/**
 * Data for the doctors list page and the profile finance tab.
 *
 * Period aggregates come from `GET /api/crm/doctors/stats`, grouped in the
 * database. The page used to download the period's raw appointments with
 * `limit=500`, which the list API refuses (max 200): every load was a 400
 * and every tile, card and chart showed zeros (audit DR-01). Only today's
 * rows are still read raw (live status, hour heatmap), through every page.
 */
export type DoctorAggregateAppointment = {
  id: string;
  date: string;
  status:
    | "BOOKED"
    | "CONFIRMED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  priceFinal: number | null;
  doctor: { id: string; nameRu: string; nameUz: string };
};

/** Mirrors `DoctorStatsRow` (server/doctors/stats.ts). */
export type DoctorAgg = {
  doctorId: string;
  total: number;
  completed: number;
  noShow: number;
  cancelled: number;
  revenue: number;
  todayCount: number;
};

export function toAggMap(rows: ReadonlyArray<DoctorAgg>): Map<string, DoctorAgg> {
  return new Map(rows.map((r) => [r.doctorId, r]));
}

export function useDoctorsStats(
  range: { from: string; to: string },
  doctorId?: string,
) {
  return useQuery<DoctorAgg[], Error>({
    queryKey: ["doctors", "stats", range, doctorId ?? null],
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (doctorId) qs.set("doctorId", doctorId);
      const res = await fetch(`/api/crm/doctors/stats?${qs.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: DoctorAgg[] };
      return j.rows;
    },
    staleTime: 60_000,
  });
}

/** Today's raw appointments of every doctor, all pages. */
export function useDoctorsDayAppointments(range: { from: string; to: string }) {
  return useQuery<DoctorAggregateAppointment[], Error>({
    queryKey: ["doctors", "day-appointments", range],
    queryFn: async ({ signal }) => {
      const { rows } = await fetchAllAppointmentPages<DoctorAggregateAppointment>(
        { from: range.from, to: range.to },
        { signal },
      );
      return rows;
    },
    staleTime: 60_000,
  });
}

/** Mirrors `DoctorTodayRow` (server/doctors/today.ts). */
export type DoctorToday = {
  doctorId: string;
  workingMinutes: number;
  booked: number;
  bookedMinutes: number;
  loadPct: number | null;
  status: "busy" | "free" | "off";
  nextFree: string | null;
  revenueToday: number;
  hours: Array<{ hour: number; workingMin: number; bookedMin: number }>;
};

/** Mirrors `DoctorsToday` (server/doctors/today.ts). */
export type DoctorsTodayData = {
  date: string | null;
  doctors: DoctorToday[];
  clinic: {
    booked: number;
    bookedMinutes: number;
    workingMinutes: number;
    loadPct: number | null;
  };
};

/**
 * Today on the doctors page, computed on the server from the schedule and
 * the real visits (audit DR-08). Refreshed every minute so the live status
 * and the next free slot follow the clock (the page used to freeze «now»
 * at mount).
 */
export function useDoctorsToday() {
  return useQuery<DoctorsTodayData, Error>({
    queryKey: ["doctors", "today"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/today", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DoctorsTodayData;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
