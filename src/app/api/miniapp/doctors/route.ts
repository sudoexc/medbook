/**
 * GET /api/miniapp/doctors?clinicSlug=…&serviceId=…
 *
 * List active doctors for the clinic, optionally narrowed to those that
 * offer a given service (via ServiceOnDoctor).
 *
 * Only ACTIVE services count (audit MA-08): an archived service still linked
 * to a doctor is neither listed nor priced («от X сум»), and a doctor with
 * no active service is left out of the wizard, since there is nothing to
 * book with him. Each doctor carries `onlineServiceId`, the service a Mini
 * App booking with him is made for (`resolveOnlineService`): the admin's
 * pick, else his only active service, else null, and the wizard then shows
 * the doctor as «запишитесь по телефону» instead of guessing.
 *
 * Each service carries THIS doctor's price (`priceOverride` over the
 * catalog, audit DR-02): the price the booking will be billed at, not the
 * catalog's.
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";
import { onlineServiceIdOf, resolveOnlineService } from "@/lib/doctors/online-service";

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId");
  const rows = await prisma.doctor.findMany({
    where: {
      clinicId: ctx.clinicId,
      isActive: true,
      services: {
        some: {
          service: { isActive: true },
          ...(serviceId ? { serviceId } : {}),
        },
      },
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
      onlineServiceId: true,
      services: {
        where: { service: { isActive: true } },
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
        orderBy: { service: { nameRu: "asc" } },
      },
    },
    orderBy: [{ nameRu: "asc" }],
  });
  const doctors = rows.map(({ onlineServiceId, ...d }) => ({
    ...d,
    onlineServiceId: onlineServiceIdOf(
      resolveOnlineService(
        onlineServiceId,
        d.services.map((l) => ({ serviceId: l.service.id, isActive: true })),
      ),
    ),
    services: d.services.map((l) => ({
      service: {
        ...l.service,
        priceBase: l.priceOverride ?? l.service.priceBase,
      },
    })),
  }));
  return ok({ doctors });
});
