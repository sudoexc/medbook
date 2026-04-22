"use client";

import { useQuery } from "@tanstack/react-query";
import { useMiniAppFetch } from "./use-miniapp-api";

export type MiniAppSlotsPayload = {
  doctorId: string;
  date: string;
  slotMin: number;
  slots: string[];
};

export function useSlots(args: {
  doctorId: string | null;
  date: string | null; // YYYY-MM-DD
  serviceIds: string[];
}) {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppSlotsPayload>({
    queryKey: ["miniapp", "slots", clinicSlug, args.doctorId, args.date, args.serviceIds],
    queryFn: async () => {
      return request<MiniAppSlotsPayload>("/api/miniapp/slots", {
        searchParams: {
          doctorId: args.doctorId ?? undefined,
          date: args.date ?? undefined,
          serviceIds: args.serviceIds,
        },
      });
    },
    enabled: !!args.doctorId && !!args.date,
  });
}
