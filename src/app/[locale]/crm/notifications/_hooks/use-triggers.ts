"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export type TriggerRow = {
  /** Event id (`TEMPLATE_EVENTS`). */
  key: string;
  /** `notifications.triggers.events.<label>` / `.timing.<timing>`. */
  label: string;
  timing: string;
  timingValues: Record<string, number>;
  /** The template sent for the event, or its newest switched-off one. */
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
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/notifications/triggers", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Triggers load failed: ${res.status}`);
      return (await res.json()) as { rows: TriggerRow[] };
    },
    staleTime: 30_000,
  });
}

/**
 * Toggling an event: off stops every template of it, on switches its newest
 * template back on (audit TG-25, see the triggers route).
 */
export function useToggleTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      event,
      enabled,
    }: {
      event: string;
      enabled: boolean;
    }) => {
      const res = await fetch("/api/crm/notifications/triggers", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ event, enabled }),
      });
      if (!res.ok) throw new Error(`Toggle failed: ${res.status}`);
      return await res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
