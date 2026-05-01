/**
 * /api/crm/cabinets/[id] — get/patch/delete.
 *
 * Cabinet binding (Phase 11):
 *   A cabinet is bound 1:1 to a doctor (Doctor.cabinetId NOT NULL UNIQUE).
 *   DELETE refuses (409) when the cabinet is currently occupied — the admin
 *   must move the doctor to a different cabinet first, or deactivate the
 *   doctor (which itself fans out to a service-orphan check).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdateCabinetSchema } from "@/server/schemas/cabinet";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.cabinet.findUnique({ where: { id } });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateCabinetSchema },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.cabinet.findUnique({ where: { id } });
    if (!before) return notFound();
    const after = await prisma.cabinet.update({ where: { id }, data: body as never });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "cabinet.update",
      entityType: "Cabinet",
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
    const before = await prisma.cabinet.findUnique({ where: { id } });
    if (!before) return notFound();
    const occupant = await prisma.doctor.findUnique({
      where: { cabinetId: id },
      select: { id: true, nameRu: true },
    });
    if (occupant) {
      return err("CabinetOccupied", 409, {
        reason: "cabinet_occupied",
        doctorId: occupant.id,
        doctorName: occupant.nameRu,
      });
    }
    await prisma.cabinet.update({ where: { id }, data: { isActive: false } });
    await audit(request, {
      action: "cabinet.deactivate",
      entityType: "Cabinet",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deactivated: true });
  }
);
