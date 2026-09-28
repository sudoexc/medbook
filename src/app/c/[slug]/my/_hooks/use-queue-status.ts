"use client";

/**
 * Wave 3a — live queue status for the home hero.
 *
 * `/api/queue/status/:token` is the public QR-ticket endpoint (no initData
 * required — it returns initials only), so we hit it with a plain fetch
 * instead of the authed mini-app request wrapper. It takes the signed ticket
 * token the appointments list hands out (`queueToken`), never the bare
 * appointment id (audit INF-10). Freshness comes from two
 * directions: a 20s poll while the hero is mounted, plus the `queue.updated`
 * SSE event which invalidates the `["miniapp","queue"]` prefix.
 */
import { useQuery } from "@tanstack/react-query";

export type MiniAppQueueStatus = {
  patientName: string;
  doctorName: string;
  clinicName: string | null;
  cabinet: string | null;
  /** queueStatus: WAITING | IN_PROGRESS | DONE | SKIPPED … */
  status: string;
  /** Two-lanes: walk-ins ("live") hold a position, bookings ("schedule") a slot time. */
  lane?: "live" | "schedule";
  slotTime?: string | null;
  /** 1-based position; 0 when not waiting; null for schedule-lane bookings. */
  position: number | null;
  totalWaiting: number;
  etaMinutes: number | null;
  etaConfidence: string;
  etaSource: string;
  ticketNumber: string;
};

export function useQueueStatus(queueToken: string | null | undefined) {
  return useQuery<MiniAppQueueStatus>({
    queryKey: ["miniapp", "queue", queueToken ?? "none"],
    enabled: !!queueToken,
    queryFn: async () => {
      const res = await fetch(
        `/api/queue/status/${encodeURIComponent(queueToken!)}`,
      );
      if (!res.ok) throw new Error(`queue status ${res.status}`);
      return (await res.json()) as MiniAppQueueStatus;
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}
