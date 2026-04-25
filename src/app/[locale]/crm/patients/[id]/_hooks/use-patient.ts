"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Shape of the `GET /api/crm/patients/[id]` response.
 * Mirrors the fields the Patient card actually renders; kept local to
 * avoid pulling Prisma types into the client bundle.
 *
 * The API returns the Patient row plus last 10 appointments via `include`.
 */
export type PatientAppointmentShort = {
  id: string;
  date: string;
  time: string | null;
  status:
    | "BOOKED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  priceFinal: number | null;
  comments: string | null;
  doctor: { id: string; nameRu: string; nameUz: string };
  primaryService: { id: string; nameRu: string; nameUz: string } | null;
};

export type Patient = {
  id: string;
  clinicId: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  birthDate: string | null;
  gender: "MALE" | "FEMALE" | null;
  passport: string | null;
  address: string | null;
  photoUrl: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  preferredChannel: "SMS" | "TG" | "CALL" | "EMAIL" | "VISIT";
  preferredLang: "RU" | "UZ";
  source:
    | "WEBSITE"
    | "TELEGRAM"
    | "INSTAGRAM"
    | "CALL"
    | "WALKIN"
    | "REFERRAL"
    | "ADS"
    | "OTHER"
    | null;
  segment: "NEW" | "ACTIVE" | "DORMANT" | "VIP" | "CHURN";
  tags: string[];
  notes: string | null;
  ltv: number;
  visitsCount: number;
  balance: number;
  discountPct: number;
  lastVisitAt: string | null;
  nextVisitAt: string | null;
  consentMarketing: boolean;
  createdAt: string;
  updatedAt: string;
  appointments?: PatientAppointmentShort[];
};

export type PatientUpdateInput = Partial<
  Omit<
    Patient,
    | "id"
    | "clinicId"
    | "phoneNormalized"
    | "ltv"
    | "visitsCount"
    | "balance"
    | "lastVisitAt"
    | "nextVisitAt"
    | "createdAt"
    | "updatedAt"
    | "appointments"
  >
>;

export const patientKey = (id: string) => ["patient", id] as const;

export function usePatient(id: string) {
  return useQuery<Patient, Error>({
    queryKey: patientKey(id),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/patients/${id}`, {
        credentials: "include",
        signal,
      });
      if (res.status === 404) throw new Error("NOT_FOUND");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Patient;
    },
    retry: (count, err) => err.message !== "NOT_FOUND" && count < 2,
    staleTime: 30_000,
  });
}

/**
 * Optimistic PATCH hook. Mutates `queryClient` cache immediately so inline-edit
 * feels instant; rolls back on server error.
 */
export function usePatchPatient(id: string) {
  const qc = useQueryClient();
  return useMutation<Patient, Error, PatientUpdateInput, { previous?: Patient }>(
    {
      mutationFn: async (patch) => {
        const res = await fetch(`/api/crm/patients/${id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as Patient;
      },
      onMutate: async (patch) => {
        await qc.cancelQueries({ queryKey: patientKey(id) });
        const previous = qc.getQueryData<Patient>(patientKey(id));
        if (previous) {
          qc.setQueryData<Patient>(patientKey(id), {
            ...previous,
            ...patch,
          } as Patient);
        }
        return { previous };
      },
      onError: (err, _patch, context) => {
        if (context?.previous) {
          qc.setQueryData(patientKey(id), context.previous);
        }
        toast.error(err.message || "Не удалось сохранить");
      },
      onSuccess: (fresh) => {
        qc.setQueryData<Patient>(patientKey(id), (prev) =>
          prev ? { ...prev, ...fresh } : fresh,
        );
      },
      onSettled: () => {
        qc.invalidateQueries({ queryKey: patientKey(id) });
      },
    },
  );
}

export function useDeletePatient(id: string) {
  const qc = useQueryClient();
  return useMutation<{ id: string; deleted: true }, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/patients/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { id: string; deleted: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.removeQueries({ queryKey: patientKey(id) });
    },
  });
}
