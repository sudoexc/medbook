"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export type TriggerRow = {
  key: string;
  template: {
    id: string;
    key: string;
    isActive: boolean;
    channel: string;
    nameRu: string;
    nameUz: string;
  } | null;
  active: boolean;
};

export function useTriggers() {
  return useQuery<{ rows: TriggerRow[] }>({
    queryKey: ["notifications", "triggers"],
    queryFn: async () => {
      const res = await fetch("/api/crm/notifications/triggers", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Triggers load failed: ${res.status}`);
      return (await res.json()) as { rows: TriggerRow[] };
    },
    staleTime: 30_000,
  });
}

/** Toggling a trigger flips the linked template's `isActive`. */
export function useToggleTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      templateId,
      isActive,
    }: {
      templateId: string;
      isActive: boolean;
    }) => {
      const res = await fetch(
        `/api/crm/notifications/templates/${templateId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ isActive }),
        },
      );
      if (!res.ok) throw new Error(`Toggle failed: ${res.status}`);
      return await res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
