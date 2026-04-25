"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

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

export type CreatePaymentInput = {
  patientId: string;
  appointmentId?: string | null;
  amount: number;
  currency?: "UZS" | "USD";
  method: PatientPayment["method"];
  status?: PatientPayment["status"];
};

export function useCreatePayment(patientId: string) {
  const qc = useQueryClient();
  return useMutation<PatientPayment, Error, CreatePaymentInput>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/crm/payments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          currency: input.currency ?? "UZS",
          status: input.status ?? "PAID",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as PatientPayment;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patient", patientId, "payments"] });
      qc.invalidateQueries({ queryKey: ["patient", patientId] });
      toast.success("Платёж добавлен");
    },
    onError: (e) => toast.error(e.message || "Не удалось создать платёж"),
  });
}
