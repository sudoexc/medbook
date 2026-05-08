"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Unified timeline returned by `GET /api/crm/patients/[id]/communications`.
 * See `src/app/api/crm/patients/[id]/communications/route.ts` for the shape.
 *
 * Phase 12: extended `kind` with payment/document/case/reschedule and added
 * the `category` field used by the patient-timeline tabs (ALL/VISIT/PAYMENT/
 * COMM/DOC). The drawer reads only the original fields so this is fully
 * backward-compatible.
 */
export type CommunicationItemKind =
  | "communication"
  | "call"
  | "notification"
  | "visit"
  | "message"
  | "payment"
  | "document"
  | "case"
  | "reschedule";

export type CommunicationCategory = "VISIT" | "PAYMENT" | "COMM" | "DOC";

export type CommunicationItem = {
  id: string;
  kind: CommunicationItemKind;
  at: string;
  channel?: "SMS" | "TG" | "CALL" | "EMAIL" | "VISIT" | string;
  direction?: "IN" | "OUT" | "MISSED" | string;
  title: string;
  body?: string | null;
  meta?: unknown;
  /** Phase 12 — required on the server response, optional in the client type
   *  for safety against older cached responses. */
  category?: CommunicationCategory;
};

export type CommunicationFilter =
  | "ALL"
  | "VISIT"
  | "PAYMENT"
  | "COMM"
  | "DOC"
  // Legacy filter values still used by older surfaces:
  | "SMS"
  | "TG"
  | "CALL";

export function usePatientCommunications(patientId: string) {
  return useQuery<{ items: CommunicationItem[] }, Error>({
    queryKey: ["patient", patientId, "communications"],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/patients/${patientId}/communications`,
        {  credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: CommunicationItem[] };
    },
    staleTime: 15_000,
  });
}

/**
 * Client-side filter helper — the API returns everything in one call.
 *
 * Recognises both the new category buckets (VISIT/PAYMENT/COMM/DOC) and the
 * legacy channel-style filters (SMS/TG/CALL) so older callers keep working.
 */
export function filterTimeline(
  items: CommunicationItem[] | undefined,
  filter: CommunicationFilter,
): CommunicationItem[] {
  if (!items) return [];
  if (filter === "ALL") return items;
  return items.filter((it) => {
    if (filter === "VISIT")
      return it.category === "VISIT" || it.kind === "visit";
    if (filter === "PAYMENT")
      return it.category === "PAYMENT" || it.kind === "payment";
    if (filter === "COMM")
      return (
        it.category === "COMM" ||
        it.kind === "call" ||
        it.kind === "message" ||
        it.kind === "communication" ||
        it.kind === "notification"
      );
    if (filter === "DOC")
      return it.category === "DOC" || it.kind === "document";
    if (filter === "CALL") return it.kind === "call" || it.channel === "CALL";
    if (filter === "SMS") return it.channel === "SMS";
    if (filter === "TG") return it.channel === "TG";
    return true;
  });
}
