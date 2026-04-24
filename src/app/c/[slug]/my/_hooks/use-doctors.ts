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
  services: {
    service: { id: string; category: string | null; priceBase: number };
  }[];
};

/**
 * Pick the default service for a doctor — the one we auto-assign to the
 * booking draft when the wizard advances past the doctor step (the API
 * still requires `serviceIds[]`, but the UX only asks the patient to pick
 * a specialty → doctor → slot). Prefers a consultation-category service,
 * then falls back to the cheapest one the doctor offers.
 */
export function pickDefaultService(
  links: MiniAppDoctor["services"],
): string | null {
  if (links.length === 0) return null;
  const consult = links.find((l) =>
    (l.service.category ?? "").toLowerCase().includes("консульт"),
  );
  if (consult) return consult.service.id;
  const cheapest = [...links].sort(
    (a, b) => a.service.priceBase - b.service.priceBase,
  )[0];
  return cheapest?.service.id ?? null;
}

/**
 * Fetch doctors for the clinic. Pass a `serviceId` to narrow to doctors who
 * offer that service; pass `null` to list all active doctors (used by the
 * specialty/doctor steps of the booking wizard, which first groups by
 * `specializationRu`).
 */
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
  });
}
