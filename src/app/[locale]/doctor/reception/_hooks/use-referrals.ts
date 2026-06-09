/**
 * P2.1 — React-Query hooks for clinical referrals (направления) from the
 * reception view.
 *
 * Issuing a referral has no print preview to open (unlike Rx / sick-leave):
 * the patient-facing REFERRAL PDF is rendered asynchronously by the
 * `referral-document` worker, so the mutation just invalidates the referrals
 * list and the doctor's incoming/outgoing queues refresh on the SSE event.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type CreateReferralInput = {
  patientId: string;
  toDoctorId?: string | null;
  externalTo?: string | null;
  visitNoteId?: string | null;
  reason: string;
  diagnosisCode?: string | null;
  diagnosisName?: string | null;
};

type CreatedRow = { id: string };

export const referralsKey = ["clinical-forms", "referrals"] as const;
export const colleaguesKey = ["referrals", "colleagues"] as const;

async function postJson<TIn, TOut>(url: string, body: TIn): Promise<TOut> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // swallow
    }
    throw new Error(`(${res.status}) ${detail}`);
  }
  return (await res.json()) as TOut;
}

export function useCreateReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReferralInput) =>
      postJson<CreateReferralInput, CreatedRow>("/api/crm/referrals", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: referralsKey });
    },
  });
}

export type Colleague = { userId: string; nameRu: string; specializationRu: string };

/**
 * Active doctors in the clinic that can receive an internal referral. Filtered
 * to those backed by a User account (Referral.toDoctorId → User) — a Doctor
 * profile with no login can't be a target. Self-exclusion is the caller's job
 * (it needs the current user's id from the profile).
 */
export function useReferableColleagues(enabled: boolean) {
  return useQuery({
    queryKey: colleaguesKey,
    enabled,
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<Colleague[]> => {
      const res = await fetch("/api/crm/doctors?isActive=true&limit=100", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`doctors: ${res.status}`);
      const data = (await res.json()) as {
        rows: Array<{
          userId: string | null;
          nameRu: string;
          specializationRu: string;
        }>;
      };
      return data.rows
        .filter((r): r is typeof r & { userId: string } => Boolean(r.userId))
        .map((r) => ({
          userId: r.userId,
          nameRu: r.nameRu,
          specializationRu: r.specializationRu,
        }));
    },
  });
}
