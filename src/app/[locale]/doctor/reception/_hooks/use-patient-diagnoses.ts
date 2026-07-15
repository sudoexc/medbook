"use client";

import { useQuery } from "@tanstack/react-query";

export type PatientDiagnosisRow = {
  visitNoteId: string;
  appointmentId: string;
  date: string;
  diagnosisCode: string;
  diagnosisName: string | null;
  doctorName: string;
  doctorSpecialty: string | null;
};

export function patientDiagnosesKey(patientId: string) {
  return ["doctor", "reception", "patient-diagnoses", patientId] as const;
}

/**
 * Full chronological ICD-10 diagnosis history for a patient, across all
 * doctors in the clinic. Backs the «История диагнозов» card.
 */
export function usePatientDiagnoses(patientId: string | null | undefined) {
  return useQuery({
    queryKey: patientDiagnosesKey(patientId ?? ""),
    enabled: Boolean(patientId),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/doctors/me/patients/${patientId}/diagnoses?limit=50`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`patient diagnoses: ${res.status}`);
      const data = (await res.json()) as { rows: PatientDiagnosisRow[] };
      return data.rows;
    },
  });
}
