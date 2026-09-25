"use client";

import { useQuery } from "@tanstack/react-query";

export type PatientPayment = {
  id: string;
  currency: "UZS" | "USD";
  amount: number;
  amountUsdSnap: number | null;
  method:
    | "CASH"
    | "CARD"
    | "TRANSFER"
    | "PAYME"
    | "CLICK"
    | "UZUM"
    | "OTHER";
  status: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  paidAt: string | null;
  createdAt: string;
  appointmentId: string | null;
  appointment: { id: string; date: string; doctorId: string } | null;
  receiptNumber: string | null;
};

export type PaymentsListResponse = {
  rows: PatientPayment[];
  nextCursor: string | null;
  total: number;
};

export function usePatientPayments(patientId: string) {
  return useQuery<PaymentsListResponse, Error>({
    queryKey: ["patient", patientId, "payments"],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/payments?patientId=${encodeURIComponent(patientId)}&limit=100`,
        {  credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PaymentsListResponse;
    },
    staleTime: 15_000,
  });
}
