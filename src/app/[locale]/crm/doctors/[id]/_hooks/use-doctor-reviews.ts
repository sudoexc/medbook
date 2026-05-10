"use client";

import { useQuery } from "@tanstack/react-query";

export type DoctorReviewRow = {
  id: string;
  score: number;
  comment: string | null;
  source: string;
  respondedAt: string;
  appointmentId: string | null;
  patientId: string | null;
  patientName: string | null;
};

export type DoctorReviewsSummary = {
  count: number;
  avgScore: number | null;
  distribution: Record<string, number>;
};

export type DoctorReviewsResponse = {
  rows: DoctorReviewRow[];
  nextCursor: string | null;
  summary: DoctorReviewsSummary;
};

export function useDoctorReviews(doctorId: string, limit = 20) {
  return useQuery<DoctorReviewsResponse, Error>({
    queryKey: ["doctor", doctorId, "reviews", { limit }],
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      const res = await fetch(
        `/api/crm/doctors/${doctorId}/reviews?${qs.toString()}`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DoctorReviewsResponse;
    },
    staleTime: 60_000,
  });
}
