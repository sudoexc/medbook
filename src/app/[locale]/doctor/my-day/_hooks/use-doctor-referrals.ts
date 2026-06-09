"use client";

/**
 * P2.1 — Incoming clinical referrals (направления) addressed to the signed-in
 * doctor, for the my-day queue card.
 *
 * Scoped server-side to `toDoctorId = me` (the API derives that from the session,
 * not a client param), filtered to PENDING — the doctor hasn't yet acted on the
 * hand-off. `referral.created` is best-effort SSE; the card refetches on it but
 * the data is also correct on a cold load, so a dropped event only delays the
 * badge, never loses a referral.
 */
import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

export type IncomingReferral = {
  id: string;
  patientId: string;
  patientName: string;
  fromDoctorName: string | null;
  reason: string;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  status: "PENDING" | "SCHEDULED" | "COMPLETED" | "CANCELLED";
  createdAt: string;
};

export const incomingReferralsKey = ["doctor", "me", "referrals", "incoming"] as const;

export function useIncomingReferrals() {
  const query = useQuery<IncomingReferral[], Error>({
    queryKey: incomingReferralsKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        "/api/crm/referrals?scope=incoming&status=PENDING&limit=20",
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`referrals: ${res.status}`);
      const data = (await res.json()) as { rows: IncomingReferral[] };
      return data.rows;
    },
    staleTime: 15_000,
  });

  useLiveQueryInvalidation({
    events: ["referral.created"],
    queryKey: incomingReferralsKey,
  });

  return query;
}
