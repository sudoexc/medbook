"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export type DormantBucket = "90-180" | "180-365" | "365+";
export type CampaignChannel = "TG";

export type CampaignRow = {
  id: string;
  name: string;
  channel: string;
  status: string;
  templateId: string | null;
  segment: { kind: "dormant"; bucket: DormantBucket } | null;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  template: { id: string; nameRu: string; nameUz: string; key: string } | null;
  createdBy: { id: string; name: string | null } | null;
};

export type CampaignListResponse = {
  rows: CampaignRow[];
  nextCursor: string | null;
};

export function campaignsKey() {
  return ["notifications", "campaigns"] as const;
}

export function useCampaigns(opts?: { limit?: number }) {
  const limit = opts?.limit ?? 50;
  return useQuery<CampaignListResponse>({
    queryKey: [...campaignsKey(), { limit }],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/campaigns?limit=${limit}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Failed to load campaigns: ${res.status}`);
      return (await res.json()) as CampaignListResponse;
    },
    staleTime: 15_000,
  });
}

export type DormantPreview = {
  bucket: DormantBucket;
  channel: CampaignChannel;
  total: number;
  eligible: number;
  channelBreakdown: {
    tgReady: number;
    noChannel: number;
    optedOut: number;
  };
  sample: Array<{
    id: string;
    fullName: string;
    preferredLang: "RU" | "UZ";
    lastVisitAt: string | null;
  }>;
};

export function useDormantPreview(args: {
  bucket: DormantBucket | null;
  channel: CampaignChannel;
}) {
  const { bucket, channel } = args;
  return useQuery<DormantPreview>({
    queryKey: ["notifications", "campaigns", "dormant-preview", bucket, channel],
    enabled: bucket !== null,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/campaigns/dormant/${bucket}/preview?channel=${channel}`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`Failed to load audience: ${res.status}`);
      return (await res.json()) as DormantPreview;
    },
    staleTime: 30_000,
  });
}

export type CreateCampaignInput = {
  name: string;
  channel: CampaignChannel;
  templateId: string;
  segment: { kind: "dormant"; bucket: DormantBucket };
};

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCampaignInput): Promise<{ id: string }> => {
      const res = await fetch("/api/crm/campaigns", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Create failed: ${res.status} ${text}`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campaignsKey() });
    },
  });
}

export type LaunchCampaignInput = {
  id: string;
  sourceActionId?: string | null;
};

export type LaunchCampaignResult = {
  campaignId: string;
  status: string;
  totalCount: number;
  alreadyLaunched: boolean;
};

export function useLaunchCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LaunchCampaignInput): Promise<LaunchCampaignResult> => {
      const res = await fetch(`/api/crm/campaigns/${input.id}/launch`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceActionId: input.sourceActionId ?? null }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Launch failed: ${res.status} ${text}`);
      }
      return (await res.json()) as LaunchCampaignResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: campaignsKey() });
      void qc.invalidateQueries({ queryKey: ["actions"] });
      void qc.invalidateQueries({ queryKey: ["actionCenter"] });
    },
  });
}
