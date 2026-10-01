"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { shellSummaryKey } from "@/hooks/use-shell-summary";
import { tashkentDayWindow, tashkentToday } from "@/lib/tashkent-time";

import { CallsLoadError } from "./use-incoming-calls";
import type { CallListResponse, CallRow } from "./types";

/**
 * Today's missed calls for the «Пропущенные» tab (audit CM-13).
 *
 * The badge in the sidebar and topbar counted them, but nothing listed
 * them: the call center loaded only ringing calls, and the hooks
 * invalidated a `["call-center", "history"]` query that did not exist.
 * Same clinic day as the badge (Tashkent), newest first; the ones already
 * called back stay in the list, marked, so the desk sees what was done.
 */
const POLL_MS = 60_000;

export const missedCallsKey = ["call-center", "missed"] as const;

async function fetchMissedToday(): Promise<CallRow[]> {
  const { from, to } = tashkentDayWindow(tashkentToday());
  const sp = new URLSearchParams();
  sp.set("direction", "MISSED");
  sp.set("from", from.toISOString());
  sp.set("to", to.toISOString());
  sp.set("limit", "200");
  const res = await fetch(`/api/crm/calls?${sp.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new CallsLoadError(res.status);
  const data = (await res.json()) as CallListResponse;
  return data.rows;
}

export function useMissedCalls() {
  return useQuery<CallRow[], Error>({
    queryKey: missedCallsKey,
    queryFn: fetchMissedToday,
    refetchInterval: POLL_MS,
    staleTime: 15_000,
  });
}

/** «Перезвонил»: POST /api/crm/calls/[id]/called-back. */
export function useMarkCalledBack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/crm/calls/${id}/called-back`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new CallsLoadError(res.status);
      return (await res.json()) as { id: string; calledBack: boolean };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: missedCallsKey });
      void qc.invalidateQueries({ queryKey: shellSummaryKey });
    },
  });
}
