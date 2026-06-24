"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { InboxConversation } from "./types";

export type Assignee = {
  id: string;
  name: string;
  role: string;
};

export function useAssignees(enabled: boolean) {
  return useQuery<{ rows: Assignee[] }>({
    queryKey: ["conversation-assignees"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/conversations/assignees", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      return (await res.json()) as { rows: Assignee[] };
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export type ClinicInfo = {
  nameRu: string;
  nameUz: string;
  phone: string | null;
  addressRu: string | null;
  addressUz: string | null;
};

export function useClinicInfo(enabled: boolean) {
  return useQuery<ClinicInfo>({
    queryKey: ["clinic-info"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/clinic", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      const c = (await res.json()) as ClinicInfo;
      return {
        nameRu: c.nameRu,
        nameUz: c.nameUz,
        phone: c.phone,
        addressRu: c.addressRu,
        addressUz: c.addressUz,
      };
    },
    enabled,
    staleTime: 10 * 60_000,
  });
}

type MetaPatch = { assignedToId?: string | null; tags?: string[] };

/**
 * Patch conversation assignment / tags. Optimistically updates the cached
 * `InboxConversation` rows so the chat header and list reflect the change
 * before the round-trip resolves.
 */
export function useUpdateConversationMeta(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: MetaPatch): Promise<InboxConversation> => {
      const res = await fetch(`/api/crm/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Update failed: ${res.status}`);
      }
      return (await res.json()) as InboxConversation;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tg-conversations"] });
    },
  });
}
