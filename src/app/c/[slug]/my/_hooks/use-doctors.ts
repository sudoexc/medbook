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
  // Accepts two API shapes so the client stays robust while the dev server
  // is rebuilding after a route-handler change: the new nested shape with
  // category + priceBase, and the legacy flat shape with just serviceId.
  services: (
    | { service: { id: string; category: string | null; priceBase: number } }
    | { serviceId: string }
  )[];
};

function linkServiceId(
  link: MiniAppDoctor["services"][number],
): string | null {
  if ("service" in link && link.service?.id) return link.service.id;
  if ("serviceId" in link && link.serviceId) return link.serviceId;
  return null;
}

/**
 * Pick the default service for a doctor — the one we auto-assign to the
 * booking draft when the wizard advances past the doctor step (the API
 * still requires `serviceIds[]`, but the UX only asks the patient to pick
 * a specialty → doctor → slot). Prefers a consultation-category service,
 * then the cheapest one; if only flat IDs are available (legacy shape),
 * returns the first one.
 */
export function pickDefaultService(
  links: MiniAppDoctor["services"],
): string | null {
  if (!links || links.length === 0) return null;
  const nested = links.filter(
    (l): l is { service: { id: string; category: string | null; priceBase: number } } =>
      "service" in l && !!l.service?.id,
  );
  if (nested.length > 0) {
    const consult = nested.find((l) =>
      (l.service.category ?? "").toLowerCase().includes("консульт"),
    );
    if (consult) return consult.service.id;
    const cheapest = [...nested].sort(
      (a, b) => a.service.priceBase - b.service.priceBase,
    )[0];
    return cheapest.service.id;
  }
  // Legacy flat shape — pick first available serviceId.
  for (const l of links) {
    const id = linkServiceId(l);
    if (id) return id;
  }
  return null;
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
    queryFn: async ({ signal }) => {
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
