/**
 * GET  /api/platform/clinics — list all clinics (no pagination; the table is small).
 * POST /api/platform/clinics — create a new clinic + its first ADMIN user.
 *
 * Onboarding model: a clinic without an owner is useless, so creation always
 * provisions one ADMIN account in the same transaction. We generate a temp
 * password server-side and return it ONCE in the response — it's never stored
 * in plaintext anywhere and never retrievable afterwards. The new admin is
 * forced to set their own password on first login (via mustChangePassword).
 *
 * SUPER_ADMIN only.
 */
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import {
  createPlatformHandler,
  createPlatformListHandler,
  platformAudit,
} from "@/server/platform/handler";
import { CreateClinicSchema } from "@/server/schemas/platform";
import { generateTempPassword, hashPassword } from "@/server/auth/password";

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
    const slugTaken = await prisma.clinic.findUnique({
      where: { slug: body.slug },
      select: { id: true },
    });
    if (slugTaken) {
      return err("conflict", 409, { reason: "slug_taken" });
    }
    // User.email is globally unique — collision must be reported before we
    // attempt the transaction so the UI can highlight the right field.
    const emailTaken = await prisma.user.findUnique({
      where: { email: body.ownerEmail },
      select: { id: true },
    });
    if (emailTaken) {
      return err("conflict", 409, { reason: "email_taken" });
    }

    const tempPassword = generateTempPassword(12);
    const passwordHash = await hashPassword(tempPassword);

    const created = await prisma.$transaction(async (tx) => {
      const clinic = await tx.clinic.create({
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
      await tx.user.create({
        data: {
          clinicId: clinic.id,
          email: body.ownerEmail,
          name: body.ownerName,
          role: "ADMIN",
          active: true,
          passwordHash,
          mustChangePassword: true,
          invitedById: userId,
        },
      });
      return clinic;
    });

    await platformAudit({
      request,
      userId,
      clinicId: created.id,
      action: "clinic.create",
      entityType: "Clinic",
      entityId: created.id,
      meta: { slug: created.slug, ownerEmail: body.ownerEmail },
    });
    return ok(
      {
        ...created,
        ownerLogin: body.ownerEmail,
        ownerTempPassword: tempPassword,
      },
      201,
    );
  },
);
