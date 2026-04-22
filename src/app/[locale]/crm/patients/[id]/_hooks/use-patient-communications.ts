"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Unified timeline returned by `GET /api/crm/patients/[id]/communications`.
 * See `src/app/api/crm/patients/[id]/communications/route.ts` for the shape.
 */
export type CommunicationItem = {
  id: string;
  kind: "communication" | "call" | "notification" | "visit" | "message";
  at: string;
  channel?: "SMS" | "TG" | "CALL" | "EMAIL" | "VISIT" | string;
  direction?: "IN" | "OUT" | "MISSED" | string;
  title: string;
  body?: string | null;
  meta?: unknown;
};

export type CommunicationFilter = "ALL" | "SMS" | "TG" | "CALL" | "VISIT";

export function usePatientCommunications(patientId: string) {
  return useQuery<{ items: CommunicationItem[] }, Error>({
    queryKey: ["patient", patientId, "communications"],
    queryFn: async () => {
      const res = await fetch(
        `/api/crm/patients/${patientId}/communications`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: CommunicationItem[] };
    },
    staleTime: 15_000,
  });
}

/** Client-side filter helper — the API returns everything in one call. */
export function filterTimeline(
  items: CommunicationItem[] | undefined,
  filter: CommunicationFilter,
): CommunicationItem[] {
  if (!items) return [];
  if (filter === "ALL") return items;
  return items.filter((it) => {
    if (filter === "CALL") return it.kind === "call" || it.channel === "CALL";
    if (filter === "VISIT") return it.kind === "visit";
    if (filter === "SMS") return it.channel === "SMS";
    if (filter === "TG") return it.channel === "TG";
    return true;
  });
}
