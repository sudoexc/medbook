"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { QueueStatus, TemplateChannel } from "./types";

export type QueueRow = {
  id: string;
  templateId: string | null;
  patientId: string;
  appointmentId: string | null;
  channel: TemplateChannel;
  recipient: string;
  body: string;
  status: QueueStatus;
  scheduledFor: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedReason: string | null;
  externalId: string | null;
  retryCount: number;
  createdAt: string;
  patient: { id: string; fullName: string; phone: string } | null;
  template: { id: string; nameRu: string; nameUz: string } | null;
};

export type QueueResponse = { rows: QueueRow[]; nextCursor: string | null };

export function queueKey(status: QueueStatus | null) {
  return ["notifications", "queue", status] as const;
}

export function useQueue(status: QueueStatus | null) {
  return useQuery<QueueResponse>({
    queryKey: queueKey(status),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      params.set("limit", "200");
      const res = await fetch(
        `/api/crm/notifications/sends?${params.toString()}`,
        {  credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`Failed to load queue: ${res.status}`);
      return (await res.json()) as QueueResponse;
    },
    staleTime: 10_000,
    refetchInterval: 30_000, // TODO(realtime-engineer): swap for SSE in Phase 3a.1
  });
}

export function useRetrySend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/crm/notifications/sends/${id}/retry`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Retry failed: ${res.status}`);
      return await res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export type StatsResponse = {
  last30d: {
    total: number;
    delivered: number;
    sent: number;
    read: number;
    failed: number;
    queued: number;
  };
  today: { sent: number; failed: number; queued: number };
  activeTemplates: number;
  topTemplates: Array<{
    templateId: string | null;
    count: number;
    nameRu: string | null;
    nameUz: string | null;
  }>;
};

export function useNotificationsStats() {
  return useQuery<StatsResponse>({
    queryKey: ["notifications", "stats"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/notifications/stats", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Failed to load stats: ${res.status}`);
      return (await res.json()) as StatsResponse;
    },
    staleTime: 30_000,
  });
}
