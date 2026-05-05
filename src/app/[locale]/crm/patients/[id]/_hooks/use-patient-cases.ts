"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * MedicalCase row shape returned by `GET /api/crm/cases?patientId=...`.
 * Mirrors the `LIST_INCLUDE` shape on the route — kept local so the client
 * bundle never pulls Prisma types.
 */
export type CaseStatus = "OPEN" | "RESOLVED" | "ABANDONED" | "TRANSFERRED";

export type PatientCase = {
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
  _count: { appointments: number };
};

export type CasesListResponse = {
  rows: PatientCase[];
  nextCursor: string | null;
  total: number;
};

export type CasesFilters = {
  /** "all" returns every status; "open" returns OPEN; "closed" returns the
   * three terminal statuses (RESOLVED | ABANDONED | TRANSFERRED). */
  status?: "all" | "open" | "closed";
};

export type CreateCaseInput = {
  patientId: string;
  title: string;
  primaryDoctorId?: string | null;
  primaryComplaint?: string | null;
};

export type PatchCaseInput = {
  title?: string;
  status?: CaseStatus;
  primaryDoctorId?: string | null;
  primaryComplaint?: string | null;
  diagnosisText?: string | null;
  diagnosisCode?: string | null;
  notes?: string | null;
  closedReason?: string | null;
};

export const patientCasesKey = (
  patientId: string,
  filters: CasesFilters = {},
) => ["patient", patientId, "cases", filters] as const;

function buildSearch(patientId: string, filters: CasesFilters): string {
  const params = new URLSearchParams();
  params.set("patientId", patientId);
  // Sort newest-first by openedAt — matches the card layout (most recent
  // case at top, terminal cases visually muted but still ordered by date).
  params.set("sort", "openedAt");
  params.set("dir", "desc");
  params.set("limit", "100");
  const status = filters.status ?? "all";
  if (status === "open") {
    params.set("status", "OPEN");
  } else if (status === "closed") {
    // Server schema accepts repeated `status` params for an OR filter.
    params.append("status", "RESOLVED");
    params.append("status", "ABANDONED");
    params.append("status", "TRANSFERRED");
  }
  return params.toString();
}

export function usePatientCases(patientId: string, filters: CasesFilters = {}) {
  return useQuery<CasesListResponse, Error>({
    queryKey: patientCasesKey(patientId, filters),
    queryFn: async ({ signal }) => {
      const qs = buildSearch(patientId, filters);
      const res = await fetch(`/api/crm/cases?${qs}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as CasesListResponse;
    },
    staleTime: 15_000,
  });
}

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation<PatientCase, Error, CreateCaseInput>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/crm/cases`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as PatientCase;
    },
    onSuccess: (created) => {
      // Invalidate every filter variant for this patient — the new row
      // affects "all" + "open" lists simultaneously.
      qc.invalidateQueries({
        queryKey: ["patient", created.patientId, "cases"],
      });
    },
    onError: (err) => {
      toast.error(err.message || "Не удалось создать случай");
    },
  });
}

export function usePatchCase(caseId: string) {
  const qc = useQueryClient();
  return useMutation<PatientCase, Error, PatchCaseInput>({
    mutationFn: async (patch) => {
      const res = await fetch(`/api/crm/cases/${caseId}`, {
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
      return (await res.json()) as PatientCase;
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({
        queryKey: ["patient", updated.patientId, "cases"],
      });
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    },
    onError: (err) => {
      toast.error(err.message || "Не удалось обновить случай");
    },
  });
}
