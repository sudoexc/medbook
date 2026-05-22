"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

export type LabTestRow = {
  id: string;
  code: string;
  nameRu: string;
  nameUz: string | null;
  biomaterial:
    | "BLOOD"
    | "SERUM"
    | "PLASMA"
    | "URINE"
    | "STOOL"
    | "SALIVA"
    | "SWAB"
    | "TISSUE"
    | "CSF"
    | "SPUTUM"
    | "OTHER";
  unit: string | null;
  turnaroundHours: number;
  priceUzs: number | null;
  patientPrep: string | null;
  commonForCodes: string[];
  active: boolean;
  sortOrder: number;
};

export type LabPanelRow = {
  id: string;
  code: string;
  nameRu: string;
  nameUz: string | null;
  description: string | null;
  testCodes: string[];
  testNames: { code: string; nameRu: string }[];
  sortOrder: number;
};

type CatalogResponse = {
  tests: LabTestRow[];
  panels: LabPanelRow[];
  total: number;
};

async function fetchCatalog({
  q,
  forCode,
}: {
  q: string;
  forCode: string | null;
}): Promise<CatalogResponse> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (forCode && forCode.trim()) params.set("forCode", forCode.trim());
  const res = await fetch(`/api/crm/catalogs/labs?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) return { tests: [], panels: [], total: 0 };
  return (await res.json()) as CatalogResponse;
}

export function useLabCatalog(q: string, forCode: string | null) {
  return useQuery({
    queryKey: ["lab-catalog", q, forCode ?? ""],
    queryFn: () => fetchCatalog({ q, forCode }),
    staleTime: 60_000,
  });
}

export type CreateLabOrderInput = {
  patientId: string;
  appointmentId?: string | null;
  visitNoteId?: string | null;
  testCodes: string[];
  panelCodes: string[];
  diagnosisCode?: string | null;
  notes?: string | null;
  urgency?: "ROUTINE" | "URGENT" | "STAT";
};

export type CreatedLabOrder = {
  id: string;
  orderNumber: string;
  patientId: string;
  testCodes: string[];
  panelCodes: string[];
  urgency: "ROUTINE" | "URGENT" | "STAT";
  status: "DRAFT" | "ORDERED" | "COLLECTED" | "COMPLETED" | "CANCELLED";
  createdAt: string;
};

async function postOrder(input: CreateLabOrderInput): Promise<CreatedLabOrder> {
  const res = await fetch("/api/crm/lab-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      ...input,
      urgency: input.urgency ?? "ROUTINE",
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // swallow
    }
    throw new Error(`Не удалось создать заявку (${res.status}) ${detail}`);
  }
  return (await res.json()) as CreatedLabOrder;
}

export function useCreateLabOrder() {
  return useMutation({ mutationFn: postOrder });
}
