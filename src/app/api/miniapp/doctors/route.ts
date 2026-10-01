/**
 * GET /api/miniapp/doctors?clinicSlug=…&serviceId=…
 *
 * List active doctors for the clinic, optionally narrowed to those that
 * offer a given service (via ServiceOnDoctor). Each service carries THIS
 * doctor's price (`priceOverride` over the catalog, audit DR-02): the price
 * the booking will be billed at, not the catalog's.
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId");
  const doctors = await prisma.doctor.findMany({
    where: {
      clinicId: ctx.clinicId,
      isActive: true,
      ...(serviceId
        ? { services: { some: { serviceId } } }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      nameRu: true,
      nameUz: true,
      specializationRu: true,
      specializationUz: true,
      photoUrl: true,
      bioRu: true,
      bioUz: true,
      rating: true,
      reviewCount: true,
      color: true,
      services: {
        select: {
          priceOverride: true,
          service: {
            select: {
              id: true,
              category: true,
              priceBase: true,
            },
          },
        },
      },
    },
    orderBy: [{ nameRu: "asc" }],
  });
  return ok({
    doctors: doctors.map((d) => ({
      ...d,
      services: d.services.map((l) => ({
        service: {
          ...l.service,
          priceBase: l.priceOverride ?? l.service.priceBase,
        },
      })),
    })),
  });
});
