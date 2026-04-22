/**
 * GET /api/miniapp/services?clinicSlug=…
 *
 * List all active services for the clinic. Returns id, names, duration,
 * price, category. Used by the Mini App booking flow "pick a service".
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";

export const GET = createMiniAppListHandler({}, async ({ ctx }) => {
  const services = await prisma.service.findMany({
    where: { clinicId: ctx.clinicId, isActive: true },
    select: {
      id: true,
      code: true,
      nameRu: true,
      nameUz: true,
      category: true,
      durationMin: true,
      priceBase: true,
    },
    orderBy: [{ category: "asc" }, { nameRu: "asc" }],
  });
  return ok({ services });
});
