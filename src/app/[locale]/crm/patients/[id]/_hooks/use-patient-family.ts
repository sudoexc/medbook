"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Phase 16 — read-only family view for the CRM patient card.
 * The Mini App is the source of truth for write operations; CRM only
 * reads who is connected to whom so receptionists see the full context.
 */

export type PatientFamilyRelationship = "child" | "spouse" | "parent" | "other";

export type PatientFamilyRecord = {
  ownedRelatives: Array<{
    linkId: string;
    relationship: PatientFamilyRelationship;
    createdAt: string;
    patient: {
      id: string;
      fullName: string;
      phone: string;
      birthDate: string | null;
      gender: "MALE" | "FEMALE" | null;
    };
  }>;
  linkedFromOwners: Array<{
    linkId: string;
    relationship: PatientFamilyRelationship;
    createdAt: string;
    owner: {
      id: string;
      fullName: string;
      phone: string;
      telegramUsername: string | null;
    };
  }>;
};

export function usePatientFamily(patientId: string) {
  return useQuery<PatientFamilyRecord, Error>({
    queryKey: ["patient", patientId, "family"],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/patients/${encodeURIComponent(patientId)}/family`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PatientFamilyRecord;
    },
    staleTime: 30_000,
  });
}
