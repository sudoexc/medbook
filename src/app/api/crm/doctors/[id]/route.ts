/**
 * /api/crm/doctors/[id] — get/patch/delete. See docs/TZ.md §6.6.
 * DOCTOR can PATCH only their own profile (own userId === session.user.id).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, forbidden, diff } from "@/server/http";
import { UpdateDoctorSchema } from "@/server/schemas/doctor";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.doctor.findUnique({
      where: { id },
      include: {
        services: { include: { service: true } },
        schedules: true,
        timeOffs: { where: { endAt: { gte: new Date() } } },
      },
    });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR"],
    bodySchema: UpdateDoctorSchema,
  },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.doctor.findUnique({ where: { id } });
    if (!before) return notFound();

    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      before.userId !== ctx.userId
    ) {
      return forbidden();
    }

    const after = await prisma.doctor.update({
      where: { id },
      data: body as never,
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "doctor.update",
      entityType: "Doctor",
      entityId: id,
      meta: d,
    });
    return ok(after);
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.doctor.findUnique({ where: { id } });
    if (!before) return notFound();
    await prisma.doctor.update({
      where: { id },
      data: { isActive: false },
    });
    await audit(request, {
      action: "doctor.deactivate",
      entityType: "Doctor",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deactivated: true });
  }
);
