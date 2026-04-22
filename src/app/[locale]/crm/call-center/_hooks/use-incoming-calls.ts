"use client";

import { useQuery } from "@tanstack/react-query";

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
const POLL_MS = 5_000;

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
    staleTime: POLL_MS / 2,
  });
}

export { deriveStatus };
