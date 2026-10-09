"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useLiveEvents } from "@/hooks/use-live-events";
import type { StaffCallView } from "@/lib/staff-calls";

/**
 * Data side of «Позвать регистратуру» (src/lib/staff-calls.ts). The screens
 * follow the `staff-call.updated` event and also poll, so a dropped stream
 * never leaves a call ringing or a doctor waiting without an answer.
 */
export const staffCallKeys = {
  mine: ["staff-calls", "mine"] as const,
  open: ["staff-calls", "open"] as const,
};

/** A failed answer that carries the call as it is now (someone else went). */
export class StaffCallClosedError extends Error {
  constructor(readonly call: StaffCallView | null) {
    super("staff_call_closed");
  }
}

async function postJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "POST", credentials: "include" });
  const body = (await res.json().catch(() => null)) as (T & { reason?: string; call?: StaffCallView }) | null;
  if (res.status === 409 && body?.reason === "staff_call_closed") {
    throw new StaffCallClosedError(body.call ?? null);
  }
  if (!res.ok || !body) throw new Error(body?.reason ?? `HTTP ${res.status}`);
  return body;
}

function useStaffCallEvents(enabled: boolean) {
  const qc = useQueryClient();
  useLiveEvents(
    () => {
      void qc.invalidateQueries({ queryKey: ["staff-calls"] });
    },
    {
      filter: ["staff-call.updated"],
      enabled,
      onResync: () => void qc.invalidateQueries({ queryKey: ["staff-calls"] }),
    },
  );
}

/** The doctor's own latest call, and the button's two actions. */
export function useMyStaffCall() {
  const qc = useQueryClient();
  useStaffCallEvents(true);
  const query = useQuery<StaffCallView | null, Error>({
    queryKey: staffCallKeys.mine,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/staff-calls", { credentials: "include", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { call: StaffCallView | null }).call;
    },
    // While a call is out, check often: the answer must reach him even
    // when the live stream is down.
    refetchInterval: (q) => (q.state.data ? 8_000 : 60_000),
    refetchOnWindowFocus: true,
    retry: false,
  });
  const call = useMutation<{ call: StaffCallView }, Error>({
    mutationFn: () => postJson("/api/crm/staff-calls"),
    onSuccess: (r) => qc.setQueryData(staffCallKeys.mine, r.call),
  });
  const cancel = useMutation<{ call: StaffCallView }, Error, string>({
    mutationFn: (id) => postJson(`/api/crm/staff-calls/${encodeURIComponent(id)}/cancel`),
    onSuccess: () => qc.setQueryData(staffCallKeys.mine, null),
  });
  return { query, call, cancel };
}

/** Calls still ringing, for the reception screens, and «Иду». */
export function useOpenStaffCalls(enabled: boolean) {
  const qc = useQueryClient();
  useStaffCallEvents(enabled);
  const query = useQuery<StaffCallView[], Error>({
    queryKey: staffCallKeys.open,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/staff-calls", { credentials: "include", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { calls: StaffCallView[] }).calls;
    },
    enabled,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const ack = useMutation<{ call: StaffCallView }, Error, string>({
    mutationFn: (id) => postJson(`/api/crm/staff-calls/${encodeURIComponent(id)}/ack`),
    onSettled: () => void qc.invalidateQueries({ queryKey: staffCallKeys.open }),
  });
  return { query, ack };
}
