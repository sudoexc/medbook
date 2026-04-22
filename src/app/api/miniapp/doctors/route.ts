/**
 * GET /api/miniapp/doctors?clinicSlug=…&serviceId=…
 *
 * List active doctors for the clinic, optionally narrowed to those that
 * offer a given service (via ServiceOnDoctor).
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
    },
    orderBy: [{ nameRu: "asc" }],
  });
  return ok({ doctors });
});
