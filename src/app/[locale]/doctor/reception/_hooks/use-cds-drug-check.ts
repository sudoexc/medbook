"use client";

import { useQuery } from "@tanstack/react-query";

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
};

/**
 * Ф2 — a catalog-picked structured row: checked by id, no text resolution.
 * The label goes too: it tells the engine which name the drug was picked
 * under, so «Ибупрофен» + «Нурофен (ибупрофен)» warn (audit G4-12).
 */
export type CdsDrugRow = { id: string; displayName: string };

type Args = {
  patientId: string | null;
  prescriptions: string[];
  drugRows?: CdsDrugRow[];
  diagnosisCode: string | null;
};

async function fetchCheck(args: Args): Promise<CdsResult> {
  const res = await fetch("/api/crm/cds/drug-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      patientId: args.patientId,
      prescriptions: args.prescriptions,
      drugRows: args.drugRows ?? [],
      diagnosisCode: args.diagnosisCode ?? null,
    }),
  });
  if (!res.ok) {
    return {
      warnings: [],
      resolvedDrugs: [],
      unresolvedLines: [],
      noInteractionData: [],
      noPregnancyData: [],
    };
  }
  return (await res.json()) as CdsResult;
}

export function useCdsDrugCheck(args: Args) {
  const drugRows = args.drugRows ?? [];
  const enabled =
    !!args.patientId &&
    (args.prescriptions.length > 0 || drugRows.length > 0);
  return useQuery({
    queryKey: [
      "cds-drug-check",
      args.patientId,
      args.diagnosisCode,
      args.prescriptions.join("|"),
      // A renamed row changes the check: key on the label as well as the id.
      drugRows.map((r) => `${r.id}:${r.displayName}`).join("|"),
    ],
    queryFn: () => fetchCheck(args),
    enabled,
    staleTime: 30_000,
  });
}
