"use client";

import { useQuery } from "@tanstack/react-query";
import { useMiniAppFetch } from "./use-miniapp-api";

export type MiniAppService = {
  id: string;
  code: string;
  nameRu: string;
  nameUz: string;
  category: string | null;
  durationMin: number;
  priceBase: number;
};

export function useServices() {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppService[]>({
    queryKey: ["miniapp", "services", clinicSlug],
    queryFn: async () => {
      const body = await request<{ services: MiniAppService[] }>(
        "/api/miniapp/services",
      );
      return body.services;
    },
  });
}
