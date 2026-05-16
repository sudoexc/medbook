"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type PresetField =
  | "COMPLAINTS"
  | "ANAMNESIS"
  | "EXAMINATION"
  | "PRESCRIPTIONS"
  | "ADVICE";

export type DoctorPresetRow = {
  id: string;
  field: PresetField;
  label: string;
  fieldValue: string;
  noteTemplate: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export const doctorPresetsKey = ["doctor", "me", "presets"] as const;

export function useDoctorPresets() {
  return useQuery<DoctorPresetRow[]>({
    queryKey: doctorPresetsKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/presets", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`presets ${res.status}`);
      const j = (await res.json()) as { rows: DoctorPresetRow[] };
      return j.rows;
    },
    staleTime: 60_000,
  });
}

export type CreatePresetInput = {
  field: PresetField;
  label: string;
  fieldValue: string;
  noteTemplate?: string | null;
  sortOrder?: number;
};

export function useCreatePreset() {
  const qc = useQueryClient();
  return useMutation<DoctorPresetRow, Error, CreatePresetInput>({
    mutationFn: async (input) => {
      const res = await fetch("/api/crm/doctors/me/presets", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`presets create ${res.status}`);
      return (await res.json()) as DoctorPresetRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: doctorPresetsKey }),
  });
}

export type UpdatePresetInput = Partial<{
  label: string;
  fieldValue: string;
  noteTemplate: string | null;
  sortOrder: number;
  active: boolean;
}>;

export function useUpdatePreset(id: string | null) {
  const qc = useQueryClient();
  return useMutation<DoctorPresetRow, Error, UpdatePresetInput>({
    mutationFn: async (input) => {
      if (!id) throw new Error("no preset id");
      const res = await fetch(`/api/crm/doctors/me/presets/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`presets patch ${res.status}`);
      return (await res.json()) as DoctorPresetRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: doctorPresetsKey }),
  });
}

export function useDeletePreset() {
  const qc = useQueryClient();
  return useMutation<{ id: string; deleted: true }, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/crm/doctors/me/presets/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`presets delete ${res.status}`);
      return (await res.json()) as { id: string; deleted: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: doctorPresetsKey }),
  });
}
