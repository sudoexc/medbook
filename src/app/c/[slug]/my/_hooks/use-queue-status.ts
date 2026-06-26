"use client";

/**
 * Wave 3a — live queue status for the home hero.
 *
 * `/api/queue/status/:id` is the public QR-ticket endpoint (no initData
 * required — it returns initials only), so we hit it with a plain fetch
 * instead of the authed mini-app request wrapper. Freshness comes from two
 * directions: a 20s poll while the hero is mounted, plus the `queue.updated`
 * SSE event which invalidates the `["miniapp","queue"]` prefix.
 */
import { useQuery } from "@tanstack/react-query";

export type MiniAppQueueStatus = {
  patientName: string;
  doctorName: string;
  clinicName: string | null;
  cabinet: string | null;
  service: string | null;
  /** queueStatus: WAITING | IN_PROGRESS | DONE | SKIPPED … */
  status: string;
  /** 1-based position; 0 when not waiting. */
  position: number;
  totalWaiting: number;
  etaMinutes: number;
  etaConfidence: string;
  etaSource: string;
  ticketNumber: string;
};

export function useQueueStatus(appointmentId: string | null) {
  return useQuery<MiniAppQueueStatus>({
    queryKey: ["miniapp", "queue", appointmentId ?? "none"],
    enabled: appointmentId !== null,
    queryFn: async () => {
      const res = await fetch(
        `/api/queue/status/${encodeURIComponent(appointmentId!)}`,
      );
      if (!res.ok) throw new Error(`queue status ${res.status}`);
      return (await res.json()) as MiniAppQueueStatus;
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}
