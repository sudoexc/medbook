/**
 * Phase G8 — CDS override mutation hook.
 *
 * Lets the warning card POST a justification when the doctor chooses to
 * keep going past a CDS warning. The audit row is the persistence; this
 * hook is intentionally minimal (no per-patient cache invalidation —
 * the analytics dashboard reads via a separate key).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

export type CdsOverrideReason =
  | "CLINICALLY_JUSTIFIED"
  | "PATIENT_INFORMED"
  | "ALTERNATIVES_TRIED"
  | "FALSE_POSITIVE"
  | "OTHER";

export type CdsOverrideWarningKind =
  | "ALLERGY"
  | "INTERACTION"
  | "DUPLICATE_CLASS"
  | "PREGNANCY"
  | "DIAGNOSIS_RISK";

export type CdsOverrideSeverity =
  | "CONTRAINDICATED"
  | "MAJOR"
  | "MODERATE"
  | "MINOR";

export type CreateCdsOverrideInput = {
  patientId: string;
  appointmentId?: string | null;
  visitNoteId?: string | null;
  warningKind: CdsOverrideWarningKind;
  severity: CdsOverrideSeverity;
  warningTitle: string;
  warningDetail: string;
  warningKey?: string | null;
  reason: CdsOverrideReason;
  reasonNote?: string | null;
};

type CreatedRow = { id: string };

async function postOverride(input: CreateCdsOverrideInput): Promise<CreatedRow> {
  const res = await fetch("/api/crm/cds-overrides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
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
  return (await res.json()) as CreatedRow;
}

export function useCreateCdsOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postOverride,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doctor", "analytics"] });
      qc.invalidateQueries({ queryKey: ["cds-overrides"] });
    },
  });
}

export const OVERRIDE_REASON_LABELS: Record<CdsOverrideReason, string> = {
  CLINICALLY_JUSTIFIED: "Клинически обосновано",
  PATIENT_INFORMED: "Пациент проинформирован",
  ALTERNATIVES_TRIED: "Альтернативы пробовали",
  FALSE_POSITIVE: "Ложное срабатывание",
  OTHER: "Другое",
};
