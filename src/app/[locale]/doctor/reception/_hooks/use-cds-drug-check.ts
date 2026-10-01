"use client";

import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

import { patientDiagnosesKey } from "./use-patient-diagnoses";

export type CdsSeverity = "MINOR" | "MODERATE" | "MAJOR" | "CONTRAINDICATED";

export type CdsWarningKind =
  | "ALLERGY"
  | "INTERACTION"
  | "DUPLICATE_CLASS"
  | "PREGNANCY"
  | "DIAGNOSIS_RISK";

export type CdsWarning = {
  kind: CdsWarningKind;
  severity: CdsSeverity;
  title: string;
  detail: string;
  drugA: { id: string; nameRu: string; inn: string };
  drugB?: { id: string; nameRu: string; inn: string };
};

export type CdsResolvedDrug = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: "A" | "B" | "C" | "D" | "X" | "UNKNOWN";
  lineIndex: number;
};

export type CdsResult = {
  warnings: CdsWarning[];
  resolvedDrugs: CdsResolvedDrug[];
  unresolvedLines: number[];
  /** Ids of resolved drugs the interaction base knows nothing about. */
  noInteractionData: string[];
  /**
   * Ids of resolved drugs with no known pregnancy category, sent only when
   * the patient may be pregnant. Optional: a server still on the previous
   * build omits it.
   */
  noPregnancyData?: string[];
  /**
   * What the patient already takes and the new drugs were checked against
   * (audit G4-03). Optional: a server on the previous build omits it.
   */
  currentTherapy?: CdsCurrentTherapyDrug[];
};

export type CdsCurrentTherapyDrug = {
  id: string;
  nameRu: string;
  inn: string;
  source: "COURSE" | "PATIENT_REPORTED";
  since: string | null;
};

/**
 * Ф2 — a catalog-picked structured row: checked by id, no text resolution.
 * The label goes too: it tells the engine which name the drug was picked
 * under, so «Ибупрофен» + «Нурофен (ибупрофен)» warn (audit G4-12).
 */
export type CdsDrugRow = { id: string; displayName: string };

/** One diagnosis of the visit: a code, or the clinic's own words. */
export type CdsVisitDiagnosis = { code: string | null; name: string | null };

type Args = {
  patientId: string | null;
  prescriptions: string[];
  drugRows?: CdsDrugRow[];
  diagnosisCode: string | null;
  /**
   * Every diagnosis of the visit, main first (`visitDiagnosesOf`). Left out,
   * the server reads the visit's other diagnoses from `visitNoteId`.
   */
  diagnoses?: CdsVisitDiagnosis[];
  /** The visit on screen: its own signed rows are not current therapy. */
  visitNoteId?: string | null;
};

/** Every drug check of one patient, whatever its prescriptions. */
export function cdsDrugCheckPatientKey(patientId: string) {
  return ["cds-drug-check", patientId] as const;
}

/**
 * One check: the patient's prefix, then what is prescribed. Starts with
 * `cdsDrugCheckPatientKey`, so a change of the patient's record reaches
 * every check of the patient whatever its prescriptions.
 */
export function cdsDrugCheckKey(args: Args) {
  return [
    ...cdsDrugCheckPatientKey(args.patientId ?? ""),
    args.diagnosisCode,
    // Adding a second diagnosis can raise a contraindication by itself.
    (args.diagnoses ?? []).map((d) => `${d.code ?? ""}:${d.name ?? ""}`).join("|"),
    args.prescriptions.join("|"),
    // A renamed row changes the check: key on the label as well as the id.
    (args.drugRows ?? []).map((r) => `${r.id}:${r.displayName}`).join("|"),
  ] as const;
}

/**
 * The drug check did not answer (audit VW-13). Thrown, never folded into an
 * empty result: an empty result reads as «nothing to warn about», and the
 * card then showed the same silence as for a drug outside the catalog while
 * the allergy and interaction check had simply not run.
 */
export class CdsCheckUnavailableError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`cds drug-check ${status}`);
    this.name = "CdsCheckUnavailableError";
    this.status = status;
  }
}

export async function fetchCheck(
  args: Args,
  fetchImpl: typeof fetch = fetch,
): Promise<CdsResult> {
  const res = await fetchImpl("/api/crm/cds/drug-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      patientId: args.patientId,
      prescriptions: args.prescriptions,
      drugRows: args.drugRows ?? [],
      diagnosisCode: args.diagnosisCode ?? null,
      ...(args.diagnoses ? { diagnoses: args.diagnoses } : {}),
      visitNoteId: args.visitNoteId ?? null,
    }),
  });
  if (!res.ok) throw new CdsCheckUnavailableError(res.status);
  return (await res.json()) as CdsResult;
}

/**
 * Events after which a drug check of the patient is stale although the
 * prescriptions on screen did not change (audit G3-02): an allergy,
 * diagnosis or chronic condition written elsewhere (a nurse in the CRM
 * card), a course started or stopped, a questionnaire sent. The check key
 * only holds the prescriptions, so without these the green «Конфликтов не
 * найдено» stayed up until the doctor touched the list.
 */
export const CDS_STALE_EVENTS = [
  "patient.medicalRecordChanged",
  "prescription.created",
  "prescription.updated",
  "previsit.submitted",
] as const;

export function useCdsDrugCheck(args: Args) {
  const drugRows = args.drugRows ?? [];
  const enabled =
    !!args.patientId &&
    (args.prescriptions.length > 0 || drugRows.length > 0);
  const patientId = args.patientId;
  useLiveQueryInvalidation({
    events: CDS_STALE_EVENTS,
    enabled: !!patientId,
    shouldInvalidate: (event) =>
      (event.payload as { patientId?: unknown }).patientId === patientId,
    queryKeys: patientId
      ? [
          cdsDrugCheckPatientKey(patientId),
          // The «История диагнозов» card of the same visit.
          patientDiagnosesKey(patientId),
        ]
      : [],
  });
  return useQuery({
    queryKey: cdsDrugCheckKey(args),
    queryFn: () => fetchCheck(args),
    enabled,
    staleTime: 30_000,
  });
}
