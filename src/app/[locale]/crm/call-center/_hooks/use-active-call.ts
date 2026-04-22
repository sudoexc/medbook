"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import type { CallRow } from "./types";

/**
 * URL-synced active call id (`?active=<id>`).
 *
 * When the operator picks a ringing row in the left column, we record its id
 * in the URL so the middle column has a stable identity. Clearing the id
 * means "no active call".
 */
export function useActiveCallId(): [string | null, (id: string | null) => void] {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams?.get("active") ?? null;
  const setId = React.useCallback(
    (next: string | null) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      if (next) sp.set("active", next);
      else sp.delete("active");
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
  return [id, setId];
}

/**
 * Fetches the active call row. Polls more often than the history (10s) so
 * the duration timer stays fresh-ish even before SSE.
 *
 * TODO(realtime-engineer): drop polling in favour of SSE invalidation.
 */
export function useActiveCall(id: string | null) {
  return useQuery<CallRow | null, Error>({
    queryKey: ["call-center", "active", id],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) return null;
      const res = await fetch(`/api/crm/calls/${id}`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Active call load failed: ${res.status}`);
      return (await res.json()) as CallRow;
    },
    // SSE invalidation (see `useCallCenterRealtime`) drives live refreshes.
    // Polling stays as a 60s safety net.
    refetchInterval: 60_000,
  });
}
