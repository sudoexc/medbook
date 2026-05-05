"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type {
  CaseStatus,
  PatchCaseInput,
} from "../../../patients/[id]/_hooks/use-patient-cases";

/**
 * MedicalCase detail shape returned by `GET /api/crm/cases/[id]`.
 *
 * The detail endpoint extends the list shape with:
 *   - the full appointment timeline (sorted by date asc) — used by the
 *     visits timeline and the right-rail stats card.
 *   - explicit `visitCount` so callers can label "N-th visit" without
 *     re-counting `appointments.length` on every render.
 *
 * Kept local to the cases module so the client bundle never pulls Prisma
 * types — same convention as `usePatient` / `usePatientCases`.
 */
export type CaseAppointmentRow = {
  id: string;
  date: string;
  time: string | null;
  durationMin: number;
  status:
    | "BOOKED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "SKIPPED"
    | "CANCELLED"
    | "NO_SHOW";
  doctorId: string;
  priceFinal: number | null;
  doctor: {
    id: string;
    nameRu: string;
    nameUz: string;
    color: string | null;
  } | null;
  primaryService: {
    id: string;
    nameRu: string;
    nameUz: string;
  } | null;
};

export type CaseDetail = {
  id: string;
  clinicId: string;
  patientId: string;
  primaryDoctorId: string | null;
  title: string;
  status: CaseStatus;
  primaryComplaint: string | null;
  diagnosisText: string | null;
  diagnosisCode: string | null;
  notes: string | null;
  openedAt: string;
  closedAt: string | null;
  closedReason: string | null;
  createdAt: string;
  updatedAt: string;
  primaryDoctor: {
    id: string;
    nameRu: string;
    nameUz: string;
    color: string | null;
  } | null;
  patient: {
    id: string;
    fullName: string;
    phone: string;
  };
  appointments: CaseAppointmentRow[];
  visitCount: number;
};

export const caseKey = (id: string) => ["case", id] as const;

export function useCase(id: string) {
  return useQuery<CaseDetail, Error>({
    queryKey: caseKey(id),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/cases/${id}`, {
        credentials: "include",
        signal,
      });
      if (res.status === 404) throw new Error("NOT_FOUND");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as CaseDetail;
    },
    retry: (count, err) => err.message !== "NOT_FOUND" && count < 2,
    staleTime: 15_000,
  });
}

/**
 * Optimistic PATCH hook. Mirrors `usePatchPatient`: writes the patch into
 * the cache instantly so the inline-edit feels live, then rolls back on
 * server error.
 */
export function usePatchCase(id: string) {
  const qc = useQueryClient();
  return useMutation<CaseDetail, Error, PatchCaseInput, { previous?: CaseDetail }>(
    {
      mutationFn: async (patch) => {
        const res = await fetch(`/api/crm/cases/${id}`, {
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
        return (await res.json()) as CaseDetail;
      },
      onMutate: async (patch) => {
        await qc.cancelQueries({ queryKey: caseKey(id) });
        const previous = qc.getQueryData<CaseDetail>(caseKey(id));
        if (previous) {
          qc.setQueryData<CaseDetail>(caseKey(id), {
            ...previous,
            ...patch,
          } as CaseDetail);
        }
        return { previous };
      },
      onError: (err, _patch, context) => {
        if (context?.previous) {
          qc.setQueryData(caseKey(id), context.previous);
        }
        toast.error(err.message || "Не удалось сохранить");
      },
      onSuccess: (fresh) => {
        // Server returns the case sans the heavy `appointments` array on
        // PATCH; merge into the cached detail (preserve appointments).
        qc.setQueryData<CaseDetail>(caseKey(id), (prev) =>
          prev ? { ...prev, ...fresh } : (fresh as CaseDetail),
        );
        // Invalidate every patient-cases list variant — the detail change
        // affects "all" + "open" + "closed" cards on the patient card.
        qc.invalidateQueries({
          queryKey: ["patient", fresh.patientId, "cases"],
        });
      },
      onSettled: () => {
        qc.invalidateQueries({ queryKey: caseKey(id) });
      },
    },
  );
}

/**
 * Detach an appointment from this case. The appointment row stays alive —
 * only the grouping is removed. Server returns the updated appointment
 * (with `medicalCaseId: null`); we just invalidate the case + the
 * patient appointments list so both surfaces re-render.
 */
export function useDetachAppointment(caseId: string, patientId: string) {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, { appointmentId: string }>({
    mutationFn: async ({ appointmentId }) => {
      const res = await fetch(
        `/api/crm/cases/${caseId}/detach-appointment`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: caseKey(caseId) });
      qc.invalidateQueries({ queryKey: ["patient", patientId, "cases"] });
      qc.invalidateQueries({ queryKey: ["patient", patientId, "appointments"] });
      qc.invalidateQueries({ queryKey: ["appointments", "list"] });
    },
    onError: (err) => {
      toast.error(err.message || "Не удалось отвязать запись");
    },
  });
}

/**
 * Re-export the status enum so consumers in the cases module don't need
 * to reach across to the patient card hooks.
 */
export type { CaseStatus };
