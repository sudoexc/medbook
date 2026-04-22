/**
 * GET  /api/platform/clinics — list all clinics (no pagination; the table is small).
 * POST /api/platform/clinics — create a new clinic (SUPER_ADMIN only).
 */
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import {
  createPlatformHandler,
  createPlatformListHandler,
  platformAudit,
} from "@/server/platform/handler";
import { CreateClinicSchema } from "@/server/schemas/platform";

export const GET = createPlatformListHandler(async () => {
  const rows = await prisma.clinic.findMany({
    orderBy: [{ active: "desc" }, { nameRu: "asc" }],
    select: {
      id: true,
      slug: true,
      nameRu: true,
      nameUz: true,
      timezone: true,
      currency: true,
      secondaryCurrency: true,
      active: true,
      phone: true,
      email: true,
      brandColor: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          users: true,
          patients: true,
          appointments: true,
        },
      },
    },
  });
  return ok({ clinics: rows });
});

export const POST = createPlatformHandler(
  { bodySchema: CreateClinicSchema },
  async ({ request, body, userId }) => {
    const existing = await prisma.clinic.findUnique({
      where: { slug: body.slug },
      select: { id: true },
    });
    if (existing) {
      return err("conflict", 409, { reason: "slug_taken" });
    }
    const created = await prisma.clinic.create({
      data: {
        slug: body.slug,
        nameRu: body.nameRu,
        nameUz: body.nameUz,
        addressRu: body.addressRu ?? null,
        addressUz: body.addressUz ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        timezone: body.timezone,
        currency: body.currency,
        secondaryCurrency: body.secondaryCurrency ?? null,
        brandColor: body.brandColor,
        active: body.active,
      },
    });
    await platformAudit({
      request,
      userId,
      clinicId: created.id,
      action: "clinic.create",
      entityType: "Clinic",
      entityId: created.id,
      meta: { slug: created.slug },
    });
    return ok(created, 201);
  },
);
