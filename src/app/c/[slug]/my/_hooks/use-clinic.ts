"use client";

import { useQuery } from "@tanstack/react-query";

export type ClinicInfo = {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  addressRu: string | null;
  addressUz: string | null;
  phone: string | null;
  logoUrl: string | null;
  brandColor: string;
  tgBotUsername: string | null;
};

export function useClinic(slug: string) {
  return useQuery<ClinicInfo>({
    queryKey: ["miniapp", "clinic", slug],
    queryFn: async () => {
      const res = await fetch(
        `/api/miniapp/clinic?clinicSlug=${encodeURIComponent(slug)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("clinic_not_found");
      const body = await res.json();
      return body.clinic as ClinicInfo;
    },
    staleTime: 5 * 60 * 1000,
  });
}
