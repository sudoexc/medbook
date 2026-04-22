"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";

import type { CallListResponse, CallRow, DerivedCallStatus } from "./types";

/**
 * URL-synced filters for the history column + an infinite list against
 * `/api/crm/calls`.
 *
 * Query params:
 *   h_status      — derived status filter: all | missed | answered | ended | ringing
 *   h_direction   — IN | OUT | MISSED | all
 *   h_operator    — operator user id
 *   h_from, h_to  — ISO dates
 *   h_q           — search string
 *
 * Polling is 30s — the list is "recent history", not the active queue.
 */
export type HistoryFilters = {
  status: DerivedCallStatus | "all";
  direction: "IN" | "OUT" | "MISSED" | "all";
  operatorId: string;
  from: string; // ISO
  to: string;   // ISO
  q: string;
};

const DEFAULT: HistoryFilters = {
  status: "all",
  direction: "all",
  operatorId: "",
  from: "",
  to: "",
  q: "",
};

export function useHistoryFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters: HistoryFilters = React.useMemo(() => {
    const sp = searchParams;
    const status = (sp?.get("h_status") ?? "all") as HistoryFilters["status"];
    const direction = (sp?.get("h_direction") ?? "all") as HistoryFilters["direction"];
    return {
      status:
        status === "missed" ||
        status === "answered" ||
        status === "ended" ||
        status === "ringing"
          ? status
          : "all",
      direction:
        direction === "IN" ||
        direction === "OUT" ||
        direction === "MISSED"
          ? direction
          : "all",
      operatorId: sp?.get("h_operator") ?? "",
      from: sp?.get("h_from") ?? "",
      to: sp?.get("h_to") ?? "",
      q: sp?.get("h_q") ?? "",
    };
  }, [searchParams]);

  const setFilters = React.useCallback(
    (patch: Partial<HistoryFilters>) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      const assign = (k: string, v: string | undefined) => {
        if (v === undefined) return;
        if (!v || v === "all") sp.delete(k);
        else sp.set(k, v);
      };
      if (patch.status !== undefined) assign("h_status", patch.status);
      if (patch.direction !== undefined) assign("h_direction", patch.direction);
      if (patch.operatorId !== undefined) assign("h_operator", patch.operatorId);
      if (patch.from !== undefined) assign("h_from", patch.from);
      if (patch.to !== undefined) assign("h_to", patch.to);
      if (patch.q !== undefined) assign("h_q", patch.q);
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const reset = React.useCallback(() => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    ["h_status", "h_direction", "h_operator", "h_from", "h_to", "h_q"].forEach((k) =>
      sp.delete(k),
    );
    router.replace(`?${sp.toString()}`, { scroll: false });
  }, [router, searchParams]);

  return { filters, setFilters, reset, defaults: DEFAULT };
}

async function fetchHistory(
  filters: HistoryFilters,
  cursor: string | null,
): Promise<CallListResponse> {
  const sp = new URLSearchParams();
  sp.set("limit", "50");
  if (filters.direction !== "all") sp.set("direction", filters.direction);
  if (filters.operatorId) sp.set("operatorId", filters.operatorId);
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (filters.q) sp.set("q", filters.q);
  if (cursor) sp.set("cursor", cursor);
  const res = await fetch(`/api/crm/calls?${sp.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Call history load failed: ${res.status}`);
  return (await res.json()) as CallListResponse;
}

export function useCallHistory(filters: HistoryFilters) {
  return useInfiniteQuery({
    queryKey: ["call-center", "history", filters],
    queryFn: ({ pageParam }) => fetchHistory(filters, pageParam ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
    // TODO(realtime-engineer): invalidate on `call.ended` via SSE.
    refetchInterval: 30_000,
  });
}

export function flattenHistory(
  pages: CallListResponse[] | undefined,
): CallRow[] {
  if (!pages) return [];
  const out: CallRow[] = [];
  for (const p of pages) out.push(...p.rows);
  return out;
}
