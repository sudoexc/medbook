"use client";

import { useQuery } from "@tanstack/react-query";

export type PatientsStats = {
  gender: { gender: "MALE" | "FEMALE" | null; count: number }[];
  ageGroups: { group: "0-18" | "19-35" | "36-55" | "56+"; count: number }[];
  sources: {
    source:
      | "WEBSITE"
      | "TELEGRAM"
      | "INSTAGRAM"
      | "CALL"
      | "WALKIN"
      | "REFERRAL"
      | "ADS"
      | "OTHER"
      | null;
    count: number;
  }[];
  birthdays: {
    id: string;
    fullName: string;
    phone: string;
    photoUrl: string | null;
    birthDate: string;
    daysUntil: number;
  }[];
  topTags: { tag: string; count: number }[];
};

export const patientsStatsKey = ["patients", "stats"] as const;

export function usePatientsStats() {
  return useQuery<PatientsStats, Error>({
    queryKey: patientsStatsKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/patients/stats", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Failed to load stats: ${res.status}`);
      return (await res.json()) as PatientsStats;
    },
    staleTime: 60_000,
  });
}

export type DashboardResponse = {
  today: {
    booked: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    /** Null for roles that may not see clinic revenue (audit AN-20). */
    revenue: number | null;
  };
  newPatientsThisMonth: number;
};

export function usePatientsDashboard() {
  return useQuery<DashboardResponse, Error>({
    queryKey: ["crm", "dashboard"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/dashboard", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Failed to load dashboard: ${res.status}`);
      return (await res.json()) as DashboardResponse;
    },
    staleTime: 60_000,
  });
}

/** Mirrors `PatientTiles` (src/server/patient/list-tiles.ts). */
export type PatientsTilesData = {
  total: number;
  newThisWeek: number;
  active: number;
  dormant: number;
  avgCheck: {
    visible: boolean;
    paymentsTracked: boolean;
    value: number | null;
  };
};

export const patientsTilesKey = ["patients", "tiles"] as const;

/**
 * The KPI tiles, counted on the server over the whole base (audit PT-13):
 * the numbers no longer depend on how far the list was scrolled.
 */
export function usePatientsTiles() {
  return useQuery<PatientsTilesData, Error>({
    queryKey: patientsTilesKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/patients/tiles", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Failed to load tiles: ${res.status}`);
      return (await res.json()) as PatientsTilesData;
    },
    staleTime: 60_000,
  });
}
