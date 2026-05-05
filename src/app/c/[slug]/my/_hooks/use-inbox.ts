"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

/**
 * Mini App inbox hook — fetches the patient's INAPP NotificationSend rows.
 *
 * Polls every 60s when the tab is visible (Mini App sessions are short, so
 * a tighter polling interval would mostly burn battery; 60s gives the
 * appointment-reminder cascade and case-repeat reminder enough recency
 * without spamming the server).
 *
 * Each row has `body` (already rendered by the worker — no client-side
 * templating), `appointmentId`/`caseId` for deep-link targets, and a
 * `templateKey`/`category` so we can render different variants per type.
 */
export type MiniAppInboxItem = {
  id: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  appointmentId: string | null;
  caseId: string | null;
  templateKey: string | null;
  category: "REMINDER" | "MARKETING" | "TRANSACTIONAL" | null;
};

export type MiniAppInboxResponse = {
  items: MiniAppInboxItem[];
  unreadCount: number;
};

export function useInbox() {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppInboxResponse>({
    queryKey: ["miniapp", "inbox", clinicSlug],
    queryFn: async () => request<MiniAppInboxResponse>("/api/miniapp/inbox"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useMarkInboxItemRead() {
  const { request, clinicSlug } = useMiniAppFetch();
  const qc = useQueryClient();
  return useMutation<{ id: string; readAt: string | null }, Error, string>({
    mutationFn: async (id: string) =>
      request<{ id: string; readAt: string | null }>(
        `/api/miniapp/inbox/${id}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["miniapp", "inbox", clinicSlug] });
    },
  });
}
