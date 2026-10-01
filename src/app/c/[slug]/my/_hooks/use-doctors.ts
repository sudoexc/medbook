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
  /**
   * The service a booking with this doctor is made for, decided on the
   * server (audit MA-08): the admin's pick or the doctor's only active
   * service. Null: not bookable online, the wizard says to call instead.
   */
  onlineServiceId: string | null;
};

/**
 * Min positive priceBase across a doctor's services. Returns null when no
 * priced service is linked (legacy flat shape, empty list, or all zeros).
 * Used by the booking wizard to show "от X сум" hints upfront so a patient
 * never gets sticker-shocked at the confirm step.
 */
export function minDoctorPrice(
  links: MiniAppDoctor["services"],
): number | null {
  if (!links || links.length === 0) return null;
  let min: number | null = null;
  for (const l of links) {
    if ("service" in l && l.service && typeof l.service.priceBase === "number") {
      const p = l.service.priceBase;
      if (p > 0 && (min === null || p < min)) min = p;
    }
  }
  return min;
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
