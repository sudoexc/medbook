/**
 * /api/crm/services/[id] — get/patch/delete. See docs/TZ.md §6.*.settings.
 *
 * Service-doctor invariant (Phase 11):
 *   PATCH may replace the provider list via `doctorIds`. The new list must
 *   be non-empty (services without a doctor are forbidden), and each id
 *   must resolve inside the current clinic. The whole catalog swap runs in
 *   a transaction — old links are deleted and new ones created atomically.
 *   DELETE is soft (isActive=false) and intentionally permissive: an
 *   inactive service has no booking value, so there's no orphaning concern.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdateServiceSchema } from "@/server/schemas/service";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.service.findUnique({
      where: { id },
      include: { doctors: { include: { doctor: true } } },
    });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateServiceSchema },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.service.findUnique({ where: { id } });
    if (!before) return notFound();

    const data: Record<string, unknown> = { ...body };
    const doctorIds = data.doctorIds as string[] | undefined;
    delete data.doctorIds;

    if (doctorIds !== undefined) {
      if (doctorIds.length === 0) {
        return err("DoctorInvalid", 422, { reason: "doctors_required" });
      }
      const ids = Array.from(new Set(doctorIds));
      const found = await prisma.doctor.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true },
      });
      if (found.length !== ids.length) {
        const have = new Set(found.map((d) => d.id));
        return err("DoctorInvalid", 422, {
          reason: "doctor_not_found",
          missingDoctorIds: ids.filter((x) => !have.has(x)),
        });
      }
    }

    try {
      const after = await prisma.$transaction(async (tx) => {
        const updated = await tx.service.update({
          where: { id },
          data: data as never,
        });
        if (doctorIds !== undefined) {
          await tx.serviceOnDoctor.deleteMany({ where: { serviceId: id } });
          await tx.serviceOnDoctor.createMany({
            data: Array.from(new Set(doctorIds)).map((doctorId) => ({
              doctorId,
              serviceId: id,
              priceOverride: null,
              durationMinOverride: null,
            })),
          });
        }
        return updated;
      });
      const d = diff(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>
      );
      await audit(request, {
        action: "service.update",
        entityType: "Service",
        entityId: id,
        meta: { ...d, doctorsReplaced: doctorIds !== undefined },
      });
      return ok(after);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Unique")) {
        return err("conflict", 409, { reason: "code_taken" });
      }
      throw e;
    }
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.service.findUnique({ where: { id } });
    if (!before) return notFound();
    await prisma.service.update({ where: { id }, data: { isActive: false } });
    await audit(request, {
      action: "service.deactivate",
      entityType: "Service",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deactivated: true });
  }
);
