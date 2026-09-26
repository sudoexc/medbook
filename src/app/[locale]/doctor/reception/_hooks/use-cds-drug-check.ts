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

type Args = {
  patientId: string | null;
  prescriptions: string[];
  /** Ф2 — ids from structured rows; checked by id, no text resolution. */
  drugIds?: string[];
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
      drugIds: args.drugIds ?? [],
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
  const drugIds = args.drugIds ?? [];
  const enabled =
    !!args.patientId &&
    (args.prescriptions.length > 0 || drugIds.length > 0);
  return useQuery({
    queryKey: [
      "cds-drug-check",
      args.patientId,
      args.diagnosisCode,
      args.prescriptions.join("|"),
      drugIds.join("|"),
    ],
    queryFn: () => fetchCheck(args),
    enabled,
    staleTime: 30_000,
  });
}
