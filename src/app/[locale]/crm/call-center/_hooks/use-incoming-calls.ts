"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveEvents } from "@/hooks/use-live-events";

import type { CallListResponse, CallRow } from "./types";
import { deriveStatus } from "./types";

/**
 * Polls `/api/crm/calls` for the current ringing queue.
 *
 * Until realtime-engineer wires SSE channel `call.incoming`, the UI polls
 * every 5s. The server returns *all* recent calls — we filter down to
 * "ringing" on the client (rows with direction=IN and no endedAt).
 *
 * TODO(realtime-engineer): replace polling with SSE subscription to
 * `call.incoming` / `call.ended` and invalidate this query on each event.
 */
// SSE invalidation keeps this list live; polling is a 60s safety net.
const POLL_MS = 60_000;

async function fetchRinging(): Promise<CallRow[]> {
  // Narrow to inbound + not-ended-yet. `direction=IN` is server-side;
  // "no endedAt" is client-side because there's no endedAt=null query param.
  const sp = new URLSearchParams();
  sp.set("direction", "IN");
  sp.set("limit", "50");
  const res = await fetch(`/api/crm/calls?${sp.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Incoming calls load failed: ${res.status}`);
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
 * Invalidate the incoming queue + history + active call on every `call.*`
 * event. Mount once from the call-center page client.
 */
export function useCallCenterRealtime(activeCallId: string | null): void {
  const qc = useQueryClient();
  useLiveEvents(
    (event) => {
      void qc.invalidateQueries({ queryKey: ["call-center", "incoming"] });
      void qc.invalidateQueries({ queryKey: ["call-center", "history"] });
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
