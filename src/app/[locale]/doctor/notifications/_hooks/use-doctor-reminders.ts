"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

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

export type ReminderTotals = Record<ReminderStatus, number>;

export type RemindersPage = {
  rows: Reminder[];
  nextCursor: string | null;
  totals: ReminderTotals;
};

export const remindersKey = ["doctor", "me", "reminders"] as const;
const PAGE_SIZE = 50;

/**
 * Cursor-paginated fetch (`status=ALL`) backs all three tabs on
 * /doctor/notifications. The list is bucketed client-side per tab — when
 * one bucket runs out before another, the UI fetches the next page until
 * `nextCursor` is null. `totals` from the server drives tab badges so
 * counters stay honest even when later pages haven't been loaded yet.
 */
export function useDoctorReminders() {
  const query = useInfiniteQuery<
    RemindersPage,
    Error,
    { pages: RemindersPage[]; pageParams: (string | undefined)[] },
    typeof remindersKey,
    string | undefined
  >({
    queryKey: remindersKey,
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("status", "ALL");
      params.set("limit", String(PAGE_SIZE));
      if (pageParam) params.set("cursor", pageParam);
      const res = await fetch(
        `/api/crm/doctors/me/reminders?${params.toString()}`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`reminders: ${res.status}`);
      return (await res.json()) as RemindersPage;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });

  useLiveQueryInvalidation({
    events: ["reminder.created", "reminder.updated"],
    queryKey: remindersKey,
  });

  return query;
}

export function flattenReminders(
  data: { pages: RemindersPage[] } | undefined,
): Reminder[] {
  if (!data) return [];
  const out: Reminder[] = [];
  for (const p of data.pages) out.push(...p.rows);
  return out;
}

export function totalsFromPages(
  data: { pages: RemindersPage[] } | undefined,
): ReminderTotals {
  // First page always carries fresh totals (server recomputes per request);
  // a 0-page query reflects the loading state with empty totals.
  const first = data?.pages[0]?.totals;
  return first ?? { PENDING: 0, SNOOZED: 0, DONE: 0, DISMISSED: 0 };
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
