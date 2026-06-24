"use client";

/**
 * Phase 16 Wave 3 — Medication-reminder Mini App hooks.
 *
 * GET `/api/miniapp/medications` → schedule + open reminders for the active
 * patient (or family-context patient via `onBehalfOf`). The dashboard reads
 * both arrays — `prescriptions` for the schedule list, `reminders` for the
 * actionable banner cards.
 *
 * POST `/api/miniapp/medications/:id` → mark a reminder TAKEN / SKIPPED /
 * SNOOZED. Server returns 409 with `reason: "already_responded"` if the
 * row was already settled (defense against double-tap).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

export type MedicationsPrescription = {
  id: string;
  drugName: string;
  dosage: string;
  schedule: {
    times: string[];
    days: number | null;
    startsAt: string | null;
  };
  notes: string | null;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  remindersEnabled: boolean;
  doctor: { id: string; nameRu: string; nameUz: string } | null;
  /** The visit this prescription was issued at; null for ad-hoc scripts. */
  visit: {
    appointmentId: string;
    date: string | null;
    diagnosis: string | null;
  } | null;
  nextDoseAt: string | null;
  daysRemaining: number | null;
};

export type MedicationsReminder = {
  id: string;
  prescriptionId: string;
  drugName: string;
  dosage: string;
  scheduledFor: string;
  sentAt: string | null;
  status: "PENDING" | "TAKEN" | "SKIPPED" | "SNOOZED" | "EXPIRED";
  snoozeUntil: string | null;
  respondedAt: string | null;
};

export type MedicationsResponse = {
  medicationRemindersEnabled: boolean;
  timezone: string;
  prescriptions: MedicationsPrescription[];
  reminders: MedicationsReminder[];
};

export function useMedications(onBehalfOf: string | null = null) {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MedicationsResponse>({
    queryKey: [
      "miniapp",
      "medications",
      clinicSlug,
      onBehalfOf ?? "self",
    ],
    queryFn: async () => {
      const sp: Record<string, string> = {};
      if (onBehalfOf) sp.onBehalfOf = onBehalfOf;
      return request<MedicationsResponse>("/api/miniapp/medications", {
        searchParams: sp,
      });
    },
    staleTime: 30_000,
  });
}

export type MarkReminderInput = {
  id: string;
  action: "TAKEN" | "SKIPPED" | "SNOOZED";
  snoozeMinutes?: number;
};

export type MarkReminderResponse = {
  ok: true;
  id: string;
  status: string;
  snoozeUntil: string | null;
  respondedAt: string | null;
};

export function useMarkReminder(onBehalfOf: string | null = null) {
  const { request, clinicSlug } = useMiniAppFetch();
  const qc = useQueryClient();
  return useMutation<MarkReminderResponse, Error, MarkReminderInput>({
    mutationFn: async ({ id, action, snoozeMinutes }) => {
      const sp: Record<string, string> = {};
      if (onBehalfOf) sp.onBehalfOf = onBehalfOf;
      return request<MarkReminderResponse>(
        `/api/miniapp/medications/${encodeURIComponent(id)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, snoozeMinutes }),
          searchParams: sp,
        },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["miniapp", "medications", clinicSlug],
      });
    },
  });
}
