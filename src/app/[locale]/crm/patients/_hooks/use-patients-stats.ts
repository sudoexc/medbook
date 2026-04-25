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
    revenue: number;
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
