"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Per-doctor appointments — used by:
 *   - heat-grid (current week intensity)
 *   - patients tab (derive patient list from appointments)
 *   - finance page derived stats (avg check, no-show rate)
 */
export type DoctorAppointment = {
  id: string;
  date: string;
  time: string | null;
  endDate: string;
  durationMin: number;
  status:
    | "BOOKED"
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
  return useQuery<{ rows: DoctorAppointment[] }, Error>({
    queryKey: ["doctor", doctorId, "appointments", range],
    enabled: Boolean(range),
    queryFn: async () => {
      const qs = new URLSearchParams({
        doctorId,
        limit: "500",
        ...(range ? { from: range.from, to: range.to } : {}),
      });
      const res = await fetch(`/api/crm/appointments?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { rows: DoctorAppointment[] };
    },
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
