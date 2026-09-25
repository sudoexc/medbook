"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";
import { shellSummaryKey } from "@/hooks/use-shell-summary";

export type LeadStatus = "NEW" | "CONTACTED" | "CONVERTED" | "CANCELLED";

export const LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "CONVERTED",
  "CANCELLED",
];

export type OnlineRequestRow = {
  id: string;
  name: string;
  phone: string;
  service: string | null;
  /** Day the visitor asked for (form date picker), UTC midnight. */
  date: string | null;
  status: LeadStatus;
  source: string;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  doctorId: string | null;
  doctor: { id: string; nameRu: string; nameUz: string | null } | null;
  patient: { id: string; fullName: string } | null;
  appointment: { id: string; date: string; time: string | null } | null;
};

type ListResponse = {
  rows: OnlineRequestRow[];
  nextCursor: string | null;
  tally: Record<LeadStatus, number>;
};

export const onlineRequestsKey = ["crm", "online-requests"] as const;

export function useOnlineRequests(status: LeadStatus | "ALL") {
  // Live: a new site request, another operator's status change, or a
  // booking that converted a request refreshes the list at once.
  useLiveQueryInvalidation({
    events: ["lead.created", "lead.updated", "appointment.created"],
    queryKey: onlineRequestsKey,
  });
  return useQuery<ListResponse, Error>({
    queryKey: [...onlineRequestsKey, status],
    queryFn: async ({ signal }) => {
      const sp = new URLSearchParams({ limit: "200" });
      if (status !== "ALL") sp.set("status", status);
      const res = await fetch(`/api/crm/online-requests?${sp.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}`), {
          status: res.status,
        });
      }
      return (await res.json()) as ListResponse;
    },
    // Safety net behind SSE: a desk left open overnight still catches up.
    refetchInterval: 60_000,
    staleTime: 10_000,
  });
}

export function useUpdateOnlineRequest() {
  const qc = useQueryClient();
  return useMutation<
    OnlineRequestRow,
    Error,
    { id: string; status?: LeadStatus; comment?: string | null }
  >({
    mutationFn: async ({ id, ...patch }) => {
      const res = await fetch(`/api/crm/online-requests/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as OnlineRequestRow;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: onlineRequestsKey });
      void qc.invalidateQueries({ queryKey: shellSummaryKey });
    },
  });
}
