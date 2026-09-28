"use client";

/**
 * «Add to calendar» link for one appointment (audit MA-07).
 *
 * The calendar file opens in the external browser via `tg.openLink`, which
 * carries none of our headers. It used to put the patient's initData (the
 * whole account for 24 hours) into that URL; now the server mints a link
 * that opens this one calendar file for a few minutes.
 *
 * Minted ahead of the tap and kept fresh, so the tap itself opens the link
 * synchronously: Telegram clients honour `openLink` only as a direct answer
 * to a user gesture, and a network round-trip in between could lose it.
 */
import { useQuery } from "@tanstack/react-query";

import { useMiniAppFetch } from "./use-miniapp-api";

/** Links live 5 minutes on the server; refresh well before that. */
const REFRESH_MS = 3 * 60 * 1000;

export function useIcsLink(
  appointmentId: string | null | undefined,
  onBehalfOf?: string | null,
) {
  const { request } = useMiniAppFetch();
  return useQuery<string>({
    queryKey: ["miniapp", "ics-link", appointmentId ?? "none", onBehalfOf ?? "self"],
    enabled: !!appointmentId,
    queryFn: async () => {
      const res = await request<{ url: string }>("/api/miniapp/links", {
        method: "POST",
        body: JSON.stringify({
          scope: "ics",
          appointmentId,
          ...(onBehalfOf ? { onBehalfOf } : {}),
        }),
      });
      return `${window.location.origin}${res.url}`;
    },
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
}
