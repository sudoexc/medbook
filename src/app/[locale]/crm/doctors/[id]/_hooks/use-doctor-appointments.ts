"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchAllAppointmentPages } from "@/lib/appointments/fetch-all-pages";

/**
 * Per-doctor appointments — used by:
 *   - heat-grid (current week intensity)
 *   - patients tab (derive patient list from appointments)
 * The finance tab's avg check / no-show rate come from the stats endpoint
 * (`useDoctorsStats`), not from raw rows.
 */
export type DoctorAppointment = {
  id: string;
  date: string;
  time: string | null;
  endDate: string;
  durationMin: number;
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
  patient: {
    id: string;
    fullName: string;
    phone: string;
    photoUrl: string | null;
  };
};

export function useDoctorAppointments(
  doctorId: string,
  range: { from: string; to: string } | null,
) {
  return useQuery<{ rows: DoctorAppointment[]; truncated: boolean }, Error>({
    queryKey: ["doctor", doctorId, "appointments", range],
    enabled: Boolean(range),
    // Every page of the range: one request with `limit=500` was refused by
    // the list API (max 200) and the tabs rendered the 400 as «no data»
    // (audit DR-01).
    queryFn: ({ signal }) =>
      fetchAllAppointmentPages<DoctorAppointment>(
        { doctorId, ...(range ? { from: range.from, to: range.to } : {}) },
        { signal },
      ),
    staleTime: 30_000,
  });
}

export type DoctorPatientAggregate = {
  patientId: string;
  fullName: string;
  phone: string;
  photoUrl: string | null;
  visits: number;
  lastVisitAt: string | null;
  revenue: number;
};

/**
 * Derive the per-doctor patient list from raw appointments. Server-side top-N
 * endpoint is a TODO for api-builder, but this gets us a functional tab.
 */
export function aggregatePatientsFromAppointments(
  rows: DoctorAppointment[],
): DoctorPatientAggregate[] {
  const acc = new Map<string, DoctorPatientAggregate>();
  for (const r of rows) {
    const p = r.patient;
    const prev = acc.get(p.id) ?? {
      patientId: p.id,
      fullName: p.fullName,
      phone: p.phone,
      photoUrl: p.photoUrl,
      visits: 0,
      lastVisitAt: null,
      revenue: 0,
    };
    prev.visits += 1;
    if (r.status === "COMPLETED") prev.revenue += r.priceFinal ?? 0;
    if (!prev.lastVisitAt || r.date > prev.lastVisitAt) {
      prev.lastVisitAt = r.date;
    }
    acc.set(p.id, prev);
  }
  return [...acc.values()];
}
