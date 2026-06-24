"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Overview counters for the Telegram inbox header (TZ-telegram-section.md
 * Layer 1). Polls every 60s; also invalidated on inbox events via
 * `useTgInboxAlerts` so block/link changes surface quickly.
 */

export type TelegramStats = {
  totalInTelegram: number;
  reachable: number;
  blocked: number;
  optedOut: number;
  newLast7d: number;
};

export const TG_STATS_QUERY_KEY = ["tg-stats"] as const;

export function useTelegramStats() {
  return useQuery<TelegramStats>({
    queryKey: TG_STATS_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/telegram/stats", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Telegram stats failed: ${res.status}`);
      return (await res.json()) as TelegramStats;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
