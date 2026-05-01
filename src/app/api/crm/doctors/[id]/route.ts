/**
 * /api/crm/doctors/[id] — get/patch/delete. See docs/TZ.md §6.6.
 *
 * Cabinet binding (Phase 11):
 *   PATCH validates a changed cabinetId against the same rules as POST
 *   (cabinet must be in the clinic, active, and not occupied by anyone else).
 *   When a `services` array is supplied, the route replaces ALL existing
 *   ServiceOnDoctor rows for this doctor in a single transaction so the
 *   doctor's catalog never half-applies.
 *
 *   DELETE refuses (409) when soft-deleting this doctor would leave any of
 *   their services with zero remaining active doctors — services without a
 *   provider are forbidden by product rules.
 *
 * DOCTOR can PATCH only their own profile (own userId === session.user.id),
 * and never touches cabinet/services through this path (the schema accepts
 * those fields but admin-only operations should ignore them — we keep the
 * branch tight by stripping them from the payload for non-admin callers).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, forbidden, diff } from "@/server/http";
import { UpdateDoctorSchema } from "@/server/schemas/doctor";
import { resolveEffectiveBranchId } from "@/server/branches/resolve-branch";

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
        cabinet: true,
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

    const isDoctorSelfEdit =
      ctx.kind === "TENANT" && ctx.role === "DOCTOR";

    if (isDoctorSelfEdit && before.userId !== ctx.userId) {
      return forbidden();
    }

    // Doctors can only edit their own profile fields, never cabinet/services
    // (those are admin operations). Strip them silently rather than 422.
    const data: Record<string, unknown> = { ...body };
    if (isDoctorSelfEdit) {
      delete data.cabinetId;
      delete data.services;
      delete data.branchId;
      delete data.userId;
      delete data.salaryPercent;
      delete data.pricePerVisit;
    }

    // Resolve branch only when caller passed it.
    if (Object.prototype.hasOwnProperty.call(data, "branchId")) {
      try {
        data.branchId = await resolveEffectiveBranchId(
          ctx,
          data.branchId as string | null | undefined,
        );
      } catch (e) {
        const reason = (e as { reason?: string }).reason ?? "branch_invalid";
        return err("BranchInvalid", 422, { reason });
      }
    }

    // Validate cabinet swap when caller actually changes cabinetId.
    if (
      Object.prototype.hasOwnProperty.call(data, "cabinetId") &&
      data.cabinetId !== before.cabinetId
    ) {
      const cabinetId = data.cabinetId as string | null | undefined;
      if (!cabinetId) {
        // Doctors must occupy a cabinet — null/undefined isn't allowed.
        return err("CabinetInvalid", 422, { reason: "cabinet_required" });
      }
      const cabinet = await prisma.cabinet.findUnique({
        where: { id: cabinetId },
      });
      if (!cabinet || !cabinet.isActive) {
        return err("CabinetInvalid", 422, { reason: "cabinet_not_found" });
      }
      const occupant = await prisma.doctor.findUnique({
        where: { cabinetId },
      });
      if (occupant && occupant.id !== id) {
        return err("CabinetTaken", 409, {
          reason: "cabinet_taken",
          doctorId: occupant.id,
        });
      }
    }

    // Pull `services` out — handled via ServiceOnDoctor below.
    const services = data.services as
      | { serviceId: string; priceOverride?: number | null; durationMinOverride?: number | null }[]
      | undefined;
    delete data.services;

    try {
      const after = await prisma.$transaction(async (tx) => {
        const updated = await tx.doctor.update({
          where: { id },
          data: data as never,
        });
        if (services) {
          // Replace the catalog wholesale: delete old rows, insert new.
          await tx.serviceOnDoctor.deleteMany({ where: { doctorId: id } });
          if (services.length > 0) {
            await tx.serviceOnDoctor.createMany({
              data: services.map((s) => ({
                doctorId: id,
                serviceId: s.serviceId,
                priceOverride: s.priceOverride ?? null,
                durationMinOverride: s.durationMinOverride ?? null,
              })),
            });
          }
        }
        return updated;
      });

      const d = diff(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>
      );
      await audit(request, {
        action: "doctor.update",
        entityType: "Doctor",
        entityId: id,
        meta: { ...d, servicesReplaced: Boolean(services) },
      });
      return ok(after);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Unique") && msg.includes("cabinetId")) {
        return err("CabinetTaken", 409, { reason: "cabinet_taken" });
      }
      if (msg.includes("Unique")) {
        return err("conflict", 409, { reason: "slug_taken" });
      }
      throw e;
    }
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.doctor.findUnique({ where: { id } });
    if (!before) return notFound();
    if (!before.isActive) {
      // Already deactivated — idempotent ok.
      return ok({ id, deactivated: true });
    }

    // Refuse if any of this doctor's services would be left with zero active
    // providers after the deactivation. Services without a doctor are an
    // illegal product state per Phase 11.
    const myLinks = await prisma.serviceOnDoctor.findMany({
      where: { doctorId: id },
      select: { serviceId: true },
    });
    if (myLinks.length > 0) {
      const serviceIds = myLinks.map((l) => l.serviceId);
      const otherActive = await prisma.serviceOnDoctor.findMany({
        where: {
          serviceId: { in: serviceIds },
          doctorId: { not: id },
          doctor: { isActive: true },
        },
        select: { serviceId: true },
      });
      const stillCovered = new Set(otherActive.map((r) => r.serviceId));
      const orphanedServiceIds = serviceIds.filter(
        (sid) => !stillCovered.has(sid),
      );
      if (orphanedServiceIds.length > 0) {
        return err("ServiceOrphaned", 409, {
          reason: "service_orphaned",
          orphanedServiceIds,
        });
      }
    }

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
