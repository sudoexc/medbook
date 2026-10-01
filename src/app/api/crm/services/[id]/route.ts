/**
 * /api/crm/services/[id] — get/patch/delete. See docs/TZ.md §6.*.settings.
 *
 * Service-doctor invariant (Phase 11):
 *   PATCH may replace the provider list via `doctorIds`. The new list must
 *   be non-empty (services without a doctor are forbidden), and each id
 *   must resolve inside the current clinic. The swap runs in a transaction
 *   and only touches the doctors that actually leave or join: a doctor who
 *   stays keeps his own price and duration for this service (audit DR-02),
 *   which a delete-all/recreate used to wipe on every save.
 *   Switching a retired service back on (`isActive: true`) needs an active
 *   doctor behind it, like creating one does (audit DR-07).
 *   DELETE is soft (isActive=false) and intentionally permissive: an
 *   inactive service has no booking value, so there's no orphaning concern.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { invalidateSitePrices } from "@/lib/site-prices";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdateServiceSchema } from "@/server/schemas/service";
import { serviceHasActiveDoctor } from "@/server/doctors/deactivation";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    // Only who performs the service, never the whole Doctor row: that one
    // carries the salary percent, the login id and the TV token, and this
    // endpoint is open to every staff role (audit DR-09).
    const row = await prisma.service.findUnique({
      where: { id },
      include: {
        doctors: {
          select: {
            doctorId: true,
            priceOverride: true,
            durationMinOverride: true,
            doctor: {
              select: { id: true, nameRu: true, nameUz: true, isActive: true },
            },
          },
        },
      },
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
    } else if (data.isActive === true && !before.isActive) {
      // Reactivating without naming doctors: the old links must still hold
      // an active doctor, or reception could pick the service and find
      // nobody to book it with.
      if (!(await serviceHasActiveDoctor(id))) {
        return err("ServiceOrphaned", 409, {
          reason: "service_orphaned",
          orphanedServiceIds: [id],
          orphanedServices: [
            { id, nameRu: before.nameRu, nameUz: before.nameUz },
          ],
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
          const keep = Array.from(new Set(doctorIds));
          await tx.serviceOnDoctor.deleteMany({
            where: { serviceId: id, doctorId: { notIn: keep } },
          });
          // Newcomers start on the catalog terms; existing links (and their
          // overrides) are left exactly as they were.
          await tx.serviceOnDoctor.createMany({
            data: keep.map((doctorId) => ({
              doctorId,
              serviceId: id,
              priceOverride: null,
              durationMinOverride: null,
            })),
            skipDuplicates: true,
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
      // The public price sheet shows this price on the next page load (LD-07).
      invalidateSitePrices();
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
    // A switched-off service leaves the public price sheet (LD-07).
    invalidateSitePrices();
    await audit(request, {
      action: "service.deactivate",
      entityType: "Service",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deactivated: true });
  }
);
