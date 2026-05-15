"use client";

import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

export type SegmentKey = "active" | "watch" | "dormant" | "new" | "returned";

export type Segment = {
  key: SegmentKey;
  label: string;
  count: number;
  percent: number;
};

export type DoctorPatientSegments = {
  total: number;
  segments: Segment[];
};

export const patientSegmentsKey = [
  "doctor",
  "me",
  "patient-segments",
] as const;

/**
 * Classifications shift slowly (a daysSinceLast threshold crossing fires
 * roughly once per patient per month). 5-minute staleTime keeps the donut
 * stable; SSE handles the moments that DO matter — a visit just completed
 * or a new patient was added.
 */
export function useDoctorPatientSegments() {
  const query = useQuery<DoctorPatientSegments, Error>({
    queryKey: patientSegmentsKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/patient-segments", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`patient-segments: ${res.status}`);
      return (await res.json()) as DoctorPatientSegments;
    },
    staleTime: 5 * 60_000,
  });

  // A new patient becomes "mine" only after their first COMPLETED
  // appointment with this doctor — `statusChanged` covers that. We also
  // invalidate on `created` because a fresh BOOKED appointment is the
  // common trigger for a doctor to refresh the view; the endpoint itself
  // ignores non-COMPLETED rows so the recalc is cheap.
  useLiveQueryInvalidation({
    events: ["appointment.statusChanged", "appointment.created"],
    queryKey: patientSegmentsKey,
  });

  return query;
}
