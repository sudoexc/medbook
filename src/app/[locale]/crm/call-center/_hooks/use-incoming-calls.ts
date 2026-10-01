"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveEvents } from "@/hooks/use-live-events";
import { shellSummaryKey } from "@/hooks/use-shell-summary";

import type { CallListResponse, CallRow } from "./types";
import { deriveStatus } from "./types";

/**
 * Backs the ringing queue in the call center.
 *
 * Primary transport is SSE: `useCallCenterRealtime` (below) subscribes to
 * `call.incoming` / `call.answered` / `call.ended` / `call.missed` and
 * invalidates this query on every event — events are emitted by the SIP
 * webhook at `/api/calls/sip/event`, the operator's «Завершить» / «Пропуск»
 * and the stale-call sweep. Polling is a safety net only: SSE connections
 * can drop on transformer reconnects, mobile-network flaps, or long
 * page-suspend periods, so we still refetch every 60s to backstop the queue.
 * The server filters to direction=IN calls that have not ended (`open=true`).
 */
const POLL_MS = 60_000;

/** A failed load keeps its HTTP status so the screen can say «нет доступа». */
export class CallsLoadError extends Error {
  constructor(readonly status: number) {
    super(`Calls load failed: ${status}`);
    this.name = "CallsLoadError";
  }
}

async function fetchRinging(): Promise<CallRow[]> {
  const sp = new URLSearchParams();
  sp.set("direction", "IN");
  sp.set("open", "true");
  sp.set("limit", "50");
  const res = await fetch(`/api/crm/calls?${sp.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new CallsLoadError(res.status);
  const data = (await res.json()) as CallListResponse;
  return data.rows.filter((r) => !r.endedAt);
}

export function useIncomingCalls() {
  return useQuery<CallRow[], Error>({
    queryKey: ["call-center", "incoming"],
    queryFn: fetchRinging,
    refetchInterval: POLL_MS,
    staleTime: 15_000,
  });
}

/**
 * Invalidate the incoming queue + missed list + active call + the badges on
 * every `call.*` event. Mount once from the call-center page client.
 */
export function useCallCenterRealtime(activeCallId: string | null): void {
  const qc = useQueryClient();
  useLiveEvents(
    () => {
      void qc.invalidateQueries({ queryKey: ["call-center", "incoming"] });
      void qc.invalidateQueries({ queryKey: ["call-center", "missed"] });
      void qc.invalidateQueries({ queryKey: shellSummaryKey });
      if (activeCallId) {
        void qc.invalidateQueries({
          queryKey: ["call-center", "active", activeCallId],
        });
      }
    },
    {
      filter: ["call.incoming", "call.answered", "call.ended", "call.missed"],
    },
  );
}

export { deriveStatus };
