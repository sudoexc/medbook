"use client";

import { useQuery } from "@tanstack/react-query";

export type SecuritySummary = {
  passwordSet: boolean;
  twoFactorEnabled: boolean;
  activeSessions: number;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

export const securitySummaryKey = ["doctor", "me", "security-summary"] as const;

export function useDoctorSecuritySummary() {
  return useQuery<SecuritySummary, Error>({
    queryKey: securitySummaryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/security-summary", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`security-summary: ${res.status}`);
      return (await res.json()) as SecuritySummary;
    },
    staleTime: 60_000,
  });
}
