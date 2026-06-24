"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Client hooks for the Telegram broadcast ("рассылка") composer.
 *
 * Mirrors the server segment union in `@/server/schemas/campaign`. The composer
 * only ever builds `all` / `segment` / `tag`; `dormant` stays the domain of the
 * notifications reactivation wizard, but the preview/broadcast endpoints accept
 * every kind.
 */

export type PatientSegmentKind = "NEW" | "ACTIVE" | "DORMANT" | "VIP" | "CHURN";

export type BroadcastSegment =
  | { kind: "all" }
  | { kind: "segment"; segments: PatientSegmentKind[] }
  | { kind: "tag"; tags: string[] };

/** A segment is resolvable once it carries enough to target someone. */
export function isResolvableSegment(segment: BroadcastSegment): boolean {
  switch (segment.kind) {
    case "all":
      return true;
    case "segment":
      return segment.segments.length > 0;
    case "tag":
      return segment.tags.length > 0;
  }
}

export type AudienceBreakdown = {
  tgReady: number;
  noChannel: number;
  optedOut: number;
  blocked: number;
};

export type AudiencePreview = {
  channel: "TG";
  total: number;
  eligible: number;
  channelBreakdown: AudienceBreakdown;
  sample: Array<{
    id: string;
    fullName: string;
    preferredLang: "RU" | "UZ";
    lastVisitAt: string | null;
  }>;
};

export function useBroadcastPreview(segment: BroadcastSegment | null) {
  const enabled = segment !== null && isResolvableSegment(segment);
  return useQuery<AudiencePreview>({
    queryKey: ["broadcast", "preview", segment ? JSON.stringify(segment) : null],
    enabled,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/campaigns/preview", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: "TG", segment }),
        signal,
      });
      if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
      return (await res.json()) as AudiencePreview;
    },
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export type SendBroadcastInput = {
  segment: BroadcastSegment;
  body: string;
  /** ISO string; omit / null = send now. */
  scheduledFor?: string | null;
  name?: string;
};

export type SendBroadcastResult = {
  campaignId: string;
  status: string;
  totalCount: number;
  scheduledFor: string | null;
  deferred: boolean;
};

export function useSendBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendBroadcastInput): Promise<SendBroadcastResult> => {
      const res = await fetch("/api/crm/campaigns/broadcast", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "TG",
          segment: input.segment,
          body: input.body,
          ...(input.name ? { name: input.name } : {}),
          ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Broadcast failed: ${res.status} ${text}`);
      }
      return (await res.json()) as SendBroadcastResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications", "campaigns"] });
    },
  });
}

export type CampaignSendStatus =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "CANCELLED";

export type BroadcastProgress = {
  campaign: {
    id: string;
    name: string;
    status: string;
    totalCount: number;
    scheduledFor: string | null;
  };
  sendsByStatus: Partial<Record<CampaignSendStatus, number>>;
};

export function useBroadcastProgress(campaignId: string | null) {
  return useQuery<BroadcastProgress>({
    queryKey: ["broadcast", "progress", campaignId],
    enabled: campaignId !== null,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/campaigns/${campaignId}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Progress failed: ${res.status}`);
      return (await res.json()) as BroadcastProgress;
    },
    // Poll while sends are still QUEUED; stop once the queue drains.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      const pending = data.sendsByStatus.QUEUED ?? 0;
      return pending > 0 ? 2000 : false;
    },
  });
}

export type BroadcastDerivedStatus =
  | "scheduled"
  | "sending"
  | "done"
  | "cancelled";

export type BroadcastFunnel = {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  blocked: number;
  total: number;
};

export type BroadcastHistoryItem = {
  id: string;
  name: string;
  body: string | null;
  segment: BroadcastSegment;
  scheduledFor: string | null;
  startedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  status: BroadcastDerivedStatus;
  funnel: BroadcastFunnel;
};

export function useBroadcastHistory(enabled: boolean) {
  return useQuery<BroadcastHistoryItem[]>({
    queryKey: ["broadcast", "history"],
    enabled,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/campaigns/broadcasts", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`History failed: ${res.status}`);
      const json = (await res.json()) as { items: BroadcastHistoryItem[] };
      return json.items ?? [];
    },
    // A mid-flight broadcast's funnel keeps changing — poll gently while one is
    // still sending, otherwise leave it to manual refetch / invalidation.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return data.some((b) => b.status === "sending") ? 5000 : false;
    },
    staleTime: 10_000,
  });
}

export function useCancelBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      campaignId: string,
    ): Promise<{ cancelledSends: number }> => {
      const res = await fetch(`/api/crm/campaigns/${campaignId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Cancel failed: ${res.status} ${text}`);
      }
      return (await res.json()) as { cancelledSends: number };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["broadcast", "history"] });
      void qc.invalidateQueries({ queryKey: ["notifications", "campaigns"] });
    },
  });
}

export function usePatientTags(enabled: boolean) {
  return useQuery<Array<{ tag: string; count: number }>>({
    queryKey: ["patients", "topTags"],
    enabled,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/patients/stats", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Tags failed: ${res.status}`);
      const json = (await res.json()) as {
        topTags: Array<{ tag: string; count: number }>;
      };
      return json.topTags ?? [];
    },
    staleTime: 5 * 60_000,
  });
}
