"use client";

/**
 * Stage 2.F — fetcher for the "К подтверждению" widget.
 *
 * Wraps the generic actions list endpoint with a `type=UNCONFIRMED_24H` filter
 * so the call-center widget receives only the rows it cares about. We
 * deliberately don't reuse the dashboard's `useActionsPaged` hook from the
 * action-center: the widget needs a smaller, severity-sorted slice and the
 * cursor/accumulator dance there is overkill for a 10-row sidebar.
 *
 * Live invalidation piggybacks on the `["actions"]` query key — every other
 * action consumer in the app invalidates the same root key on
 * `action.created` / `action.updated` SSE events, so this hook stays fresh
 * without a separate subscription.
 */
import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";
import { SEVERITY_RANK } from "@/lib/actions/types";
import type { ActionRow } from "../../action-center/_hooks/use-actions";

export type UnconfirmedActionRow = ActionRow & {
  payload: Extract<ActionRow["payload"], { type: "UNCONFIRMED_24H" }>;
};

type PageShape = { rows: ActionRow[]; nextCursor: string | null };

const UNCONFIRMED_LIMIT = 30;

export function useUnconfirmedActions() {
  const query = useQuery<UnconfirmedActionRow[], Error>({
    queryKey: ["actions", "list", { type: ["UNCONFIRMED_24H"], status: ["OPEN"], limit: UNCONFIRMED_LIMIT }],
    queryFn: async ({ signal }) => {
      const sp = new URLSearchParams();
      sp.append("type", "UNCONFIRMED_24H");
      sp.append("status", "OPEN");
      sp.set("limit", String(UNCONFIRMED_LIMIT));
      const res = await fetch(`/api/crm/actions?${sp.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PageShape;
      // Defensive: API may return mixed types if a caller passes extra filters
      // in the future. Filter + cast to the narrowed payload union.
      const rows = (data.rows ?? []).filter(
        (r): r is UnconfirmedActionRow =>
          r.type === "UNCONFIRMED_24H" && r.payload.type === "UNCONFIRMED_24H",
      );
      // Sort: severity desc (critical first) → appointment date asc.
      rows.sort((a, b) => {
        const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (sevDiff !== 0) return sevDiff;
        return (
          new Date(a.payload.appointmentAt).getTime() -
          new Date(b.payload.appointmentAt).getTime()
        );
      });
      return rows;
    },
    staleTime: 30_000,
  });

  // Coarse invalidation — same key family used everywhere actions live, so
  // any SSE event flips this list too.
  useLiveQueryInvalidation({
    events: ["action.created", "action.updated"],
    queryKey: ["actions"],
  });

  return query;
}
