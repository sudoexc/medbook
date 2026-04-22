"use client";

import { useQuery } from "@tanstack/react-query";
import { useMiniAppFetch } from "./use-miniapp-api";

export type MiniAppDoctor = {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string;
  specializationUz: string;
  photoUrl: string | null;
  bioRu: string | null;
  bioUz: string | null;
  rating: number | string | null;
  reviewCount: number;
  color: string;
};

export function useDoctors(serviceId: string | null) {
  const { request, clinicSlug } = useMiniAppFetch();
  return useQuery<MiniAppDoctor[]>({
    queryKey: ["miniapp", "doctors", clinicSlug, serviceId],
    queryFn: async () => {
      const body = await request<{ doctors: MiniAppDoctor[] }>(
        "/api/miniapp/doctors",
        {
          searchParams: { serviceId: serviceId ?? undefined },
        },
      );
      return body.doctors;
    },
    enabled: serviceId !== null,
  });
}
