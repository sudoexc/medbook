"use client";

import { useQuery } from "@tanstack/react-query";

import { devTasksOpenCountKey } from "./query-keys";

/**
 * The «Задачи» badge in the CRM sidebar and the doctor cabinet: tasks still
 * waiting for the developers (new + in progress). `enabled` is false for
 * roles without the board, so a nurse's browser never polls a route that
 * answers 403.
 */
export function useDevTaskOpenCount(enabled: boolean) {
  return useQuery<number, Error>({
    queryKey: devTasksOpenCountKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/dev-tasks/summary", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { open: number }).open;
    },
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
  });
}
