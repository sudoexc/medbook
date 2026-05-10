"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type AllergyRow = {
  id: string;
  patientId: string;
  substance: string;
  reaction: string | null;
  severity: "MILD" | "MODERATE" | "SEVERE";
  notes: string | null;
  recordedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChronicRow = {
  id: string;
  patientId: string;
  name: string;
  sinceDate: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DiagnosisRow = {
  id: string;
  patientId: string;
  icd10Code: string | null;
  label: string;
  diagnosedAt: string | null;
  notes: string | null;
  status: "ACTIVE" | "RESOLVED";
  createdAt: string;
  updatedAt: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as
      | { error?: string; reason?: string }
      | null;
    throw new Error(data?.reason ?? data?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// ── Allergies ────────────────────────────────────────────────────────────
export function useAllergies(patientId: string) {
  return useQuery<{ rows: AllergyRow[] }, Error>({
    queryKey: ["patient", patientId, "allergies"],
    queryFn: ({ signal }) =>
      fetch(`/api/crm/patients/${patientId}/allergies`, {
        credentials: "include",
        signal,
      }).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    staleTime: 60_000,
  });
}

export function useCreateAllergy(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<AllergyRow>) =>
      fetchJson<AllergyRow>(`/api/crm/patients/${patientId}/allergies`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", patientId, "allergies"] }),
  });
}

export function useUpdateAllergy(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & Partial<AllergyRow>) => {
      const { id, ...rest } = input;
      return fetchJson<AllergyRow>(
        `/api/crm/patients/${patientId}/allergies/${id}`,
        { method: "PATCH", body: JSON.stringify(rest) },
      );
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", patientId, "allergies"] }),
  });
}

export function useDeleteAllergy(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ id: string; deleted: true }>(
        `/api/crm/patients/${patientId}/allergies/${id}`,
        { method: "DELETE" },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", patientId, "allergies"] }),
  });
}

// ── Chronic conditions ───────────────────────────────────────────────────
export function useChronicConditions(patientId: string) {
  return useQuery<{ rows: ChronicRow[] }, Error>({
    queryKey: ["patient", patientId, "chronic"],
    queryFn: ({ signal }) =>
      fetch(`/api/crm/patients/${patientId}/chronic-conditions`, {
        credentials: "include",
        signal,
      }).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    staleTime: 60_000,
  });
}

export function useCreateChronic(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ChronicRow>) =>
      fetchJson<ChronicRow>(
        `/api/crm/patients/${patientId}/chronic-conditions`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", patientId, "chronic"] }),
  });
}

export function useUpdateChronic(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & Partial<ChronicRow>) => {
      const { id, ...rest } = input;
      return fetchJson<ChronicRow>(
        `/api/crm/patients/${patientId}/chronic-conditions/${id}`,
        { method: "PATCH", body: JSON.stringify(rest) },
      );
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", patientId, "chronic"] }),
  });
}

export function useDeleteChronic(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ id: string; deleted: true }>(
        `/api/crm/patients/${patientId}/chronic-conditions/${id}`,
        { method: "DELETE" },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", patientId, "chronic"] }),
  });
}

// ── Diagnoses ────────────────────────────────────────────────────────────
export function useDiagnoses(patientId: string) {
  return useQuery<{ rows: DiagnosisRow[] }, Error>({
    queryKey: ["patient", patientId, "diagnoses"],
    queryFn: ({ signal }) =>
      fetch(`/api/crm/patients/${patientId}/diagnoses`, {
        credentials: "include",
        signal,
      }).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    staleTime: 60_000,
  });
}

export function useCreateDiagnosis(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<DiagnosisRow>) =>
      fetchJson<DiagnosisRow>(`/api/crm/patients/${patientId}/diagnoses`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", patientId, "diagnoses"] }),
  });
}

export function useUpdateDiagnosis(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & Partial<DiagnosisRow>) => {
      const { id, ...rest } = input;
      return fetchJson<DiagnosisRow>(
        `/api/crm/patients/${patientId}/diagnoses/${id}`,
        { method: "PATCH", body: JSON.stringify(rest) },
      );
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", patientId, "diagnoses"] }),
  });
}

export function useDeleteDiagnosis(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ id: string; deleted: true }>(
        `/api/crm/patients/${patientId}/diagnoses/${id}`,
        { method: "DELETE" },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["patient", patientId, "diagnoses"] }),
  });
}
