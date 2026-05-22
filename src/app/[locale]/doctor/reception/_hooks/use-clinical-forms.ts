/**
 * Phase G7 — React-Query hooks for issuing e-prescriptions and sick leaves
 * from the reception view. Issue mutations open the print preview in a
 * new tab on success so the doctor doesn't need an extra click.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

export type RxItemInput = {
  drugId?: string | null;
  drugName: string;
  dose: string;
  route?: string | null;
  frequency: string;
  durationDays?: number | null;
  instructions?: string | null;
};

export type CreateEPrescriptionInput = {
  patientId: string;
  appointmentId?: string | null;
  visitNoteId?: string | null;
  diagnosisCode?: string | null;
  diagnosisName?: string | null;
  items: RxItemInput[];
  notes?: string | null;
  validForDays?: number;
};

export type CreateSickLeaveInput = {
  patientId: string;
  appointmentId?: string | null;
  visitNoteId?: string | null;
  diagnosisCode?: string | null;
  diagnosisName?: string | null;
  regimen: "OUTPATIENT" | "HOSPITAL" | "HOME";
  periodFrom: string;
  periodTo: string;
  restrictions?: string | null;
  notes?: string | null;
};

type CreatedRow = { id: string };

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

export function useCreateEPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEPrescriptionInput) =>
      postJson<CreateEPrescriptionInput, CreatedRow>(
        "/api/crm/e-prescriptions",
        input,
      ),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["clinical-forms", "rx"] });
      if (typeof window !== "undefined") {
        window.open(`/api/crm/e-prescriptions/${created.id}/print`, "_blank");
      }
    },
  });
}

export function useCreateSickLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSickLeaveInput) =>
      postJson<CreateSickLeaveInput, CreatedRow>(
        "/api/crm/sick-leaves",
        input,
      ),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["clinical-forms", "sl"] });
      if (typeof window !== "undefined") {
        window.open(`/api/crm/sick-leaves/${created.id}/print`, "_blank");
      }
    },
  });
}
