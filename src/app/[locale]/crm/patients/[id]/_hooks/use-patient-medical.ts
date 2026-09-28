"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

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

/**
 * Audit G3-02 — the record is written from two places: this card and the
 * doctor's visit screen (an allergy from the drug check, a diagnosis at
 * signing). Refetch the list when the other place changes it, instead of
 * showing it stale until a reload.
 */
function useMedicalRecordLive(
  patientId: string,
  record: "allergy" | "diagnosis" | "chronic",
  queryKey: readonly unknown[],
) {
  useLiveQueryInvalidation({
    events: ["patient.medicalRecordChanged"],
    enabled: Boolean(patientId),
    shouldInvalidate: (event) => {
      const p = event.payload as { patientId?: unknown; record?: unknown };
      return p.patientId === patientId && p.record === record;
    },
    queryKey,
  });
}

// ── Clinical note (audit PT-11) ─────────────────────────────────────────
export type ClinicalNote = {
  text: string;
  updatedAt: string | null;
  updatedBy: { id: string; name: string | null } | null;
};

const clinicalNoteKey = (patientId: string) =>
  ["patient", patientId, "clinical-note"] as const;

export function useClinicalNote(patientId: string) {
  return useQuery<ClinicalNote, Error>({
    queryKey: clinicalNoteKey(patientId),
    queryFn: ({ signal }) =>
      fetchJson<ClinicalNote>(`/api/crm/patients/${patientId}/clinical-note`, {
        signal,
      }),
    staleTime: 60_000,
  });
}

export function useSaveClinicalNote(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      fetchJson<ClinicalNote>(`/api/crm/patients/${patientId}/clinical-note`, {
        method: "PUT",
        body: JSON.stringify({ text }),
      }),
    onSuccess: (note) => qc.setQueryData(clinicalNoteKey(patientId), note),
  });
}

// ── Allergies ────────────────────────────────────────────────────────────
export function useAllergies(patientId: string) {
  useMedicalRecordLive(patientId, "allergy", ["patient", patientId, "allergies"]);
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
  useMedicalRecordLive(patientId, "chronic", ["patient", patientId, "chronic"]);
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
  useMedicalRecordLive(patientId, "diagnosis", ["patient", patientId, "diagnoses"]);
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
