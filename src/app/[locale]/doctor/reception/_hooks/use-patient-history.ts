"use client";

/**
 * Ф7 — «один клик в историю» из сессии приёма.
 *
 * Тонкие мутации поверх существующих CRUD-роутов карточки пациента:
 *   - диагноз → PatientChronicCondition («в хронические»)
 *   - аллергия из CDS-карточки → PatientAllergy
 * Финализация апсертит PatientDiagnosis сама (server-side).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useAddChronicCondition(patientId: string | null) {
  return useMutation<unknown, Error, { name: string; notes?: string | null }>({
    mutationFn: async ({ name, notes }) => {
      if (!patientId) throw new Error("no patient");
      const res = await fetch(
        `/api/crm/patients/${patientId}/chronic-conditions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, notes: notes ?? null }),
        },
      );
      if (!res.ok) throw new Error(`chronic-conditions ${res.status}`);
      return res.json();
    },
  });
}

export type AllergySeverity = "MILD" | "MODERATE" | "SEVERE";

export function useRecordAllergy(patientId: string | null) {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    Error,
    { substance: string; severity: AllergySeverity }
  >({
    mutationFn: async ({ substance, severity }) => {
      if (!patientId) throw new Error("no patient");
      const res = await fetch(`/api/crm/patients/${patientId}/allergies`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ substance, severity }),
      });
      if (!res.ok) throw new Error(`allergies ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      // Свежая аллергия должна сразу подсветить конфликт в назначениях.
      qc.invalidateQueries({ queryKey: ["cds-drug-check"] });
    },
  });
}
