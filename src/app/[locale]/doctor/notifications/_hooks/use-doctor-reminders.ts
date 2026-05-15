"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

export type ReminderStatus = "PENDING" | "SNOOZED" | "DONE" | "DISMISSED";

export type Reminder = {
  id: string;
  title: string;
  body: string | null;
  remindAt: string;
  status: ReminderStatus;
  completedAt: string | null;
  patientId: string | null;
  appointmentId: string | null;
  patientFullName: string | null;
  createdAt: string;
};

export const remindersKey = ["doctor", "me", "reminders"] as const;

/**
 * One aggregate fetch (`status=ALL`) backs all three tabs on
 * /doctor/notifications. The list is small (we cap at 200 server-side and a
 * working doctor produces low-dozens of reminders per month), so a single
 * request + client-side split per tab keeps SSE invalidation trivial — one
 * key to invalidate, one refetch.
 */
export function useDoctorReminders() {
  const query = useQuery<Reminder[], Error>({
    queryKey: remindersKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/reminders?status=ALL", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`reminders: ${res.status}`);
      const j = (await res.json()) as { rows: Reminder[] };
      return j.rows;
    },
    staleTime: 15_000,
  });

  useLiveQueryInvalidation({
    events: ["reminder.created", "reminder.updated"],
    queryKey: remindersKey,
  });

  return query;
}

export type CreateReminderInput = {
  title: string;
  body?: string | null;
  remindAt: string;
  patientId?: string | null;
  appointmentId?: string | null;
};

export function useCreateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateReminderInput) => {
      const res = await fetch("/api/crm/doctors/me/reminders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: remindersKey });
      void qc.invalidateQueries({ queryKey: ["doctor", "me", "today"] });
    },
  });
}

export type PatchReminderInput = {
  id: string;
  status?: ReminderStatus;
  remindAt?: string;
  title?: string;
  body?: string | null;
};

export function usePatchReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: PatchReminderInput) => {
      const res = await fetch(`/api/crm/doctors/me/reminders/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: remindersKey });
      void qc.invalidateQueries({ queryKey: ["doctor", "me", "today"] });
    },
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/crm/doctors/me/reminders/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: remindersKey });
      void qc.invalidateQueries({ queryKey: ["doctor", "me", "today"] });
    },
  });
}
