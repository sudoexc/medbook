"use client";

import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

export type RiskReason =
  | { kind: "high_risk"; risk: number }
  | { kind: "unconfirmed_24h"; hoursToAppt: number }
  | { kind: "no_contact"; daysSinceContact: number | null };

export type RiskTodayRow = {
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  appointmentAt: string;
  doctorName: { ru: string; uz: string };
  serviceName: { ru: string; uz: string } | null;
  priceFinalTiins: number | null;
  status: "BOOKED" | "CONFIRMED" | "WAITING" | "IN_PROGRESS";
  reasons: RiskReason[];
  riskScore: number;
  actionIds: string[];
};

export type RiskTodayResponse = {
  appointments: RiskTodayRow[];
  totals: {
    total: number;
    open: number;
    handledToday: number;
    estimatedLossTiins: number;
  };
  windowStart: string;
  windowEnd: string;
};

export const RISK_TODAY_KEY = ["action-center", "risk-today"] as const;

export function useRiskToday() {
  const q = useQuery<RiskTodayResponse, Error>({
    queryKey: RISK_TODAY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/action-center/risk-today`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as RiskTodayResponse;
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  // Invalidate on Action and Appointment changes so the triage stays warm
  // without the receptionist having to refresh.
  useLiveQueryInvalidation({
    events: [
      "action.created",
      "action.updated",
      "appointment.created",
      "appointment.updated",
    ],
    queryKey: RISK_TODAY_KEY,
  });

  return q;
}
