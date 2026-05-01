/**
 * /api/crm/doctors/[id]/services — list + replace ServiceOnDoctor links.
 *
 * GET returns `{ rows }` with the full Service row embedded so the UI can
 * render base price and duration without a second fetch.
 *
 * PUT is idempotent: the body's `assignments` array replaces the entire
 * set atomically inside a transaction (deleteMany → createMany).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";
import { UpdateDoctorServicesSchema } from "@/server/schemas/doctor-services";

function doctorIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../doctors/[id]/services
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const doctorId = doctorIdFromUrl(request);
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { id: true },
    });
    if (!doctor) return notFound();

    const rows = await prisma.serviceOnDoctor.findMany({
      where: { doctorId },
      include: {
        service: {
          select: {
            id: true,
            code: true,
            nameRu: true,
            nameUz: true,
            durationMin: true,
            priceBase: true,
            isActive: true,
          },
        },
      },
      orderBy: { service: { nameRu: "asc" } },
    });

    return ok({
      rows: rows.map((r) => ({
        serviceId: r.serviceId,
        service: r.service,
        priceOverride: r.priceOverride,
        durationMinOverride: r.durationMinOverride,
      })),
    });
  }
);

export const PUT = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateDoctorServicesSchema },
  async ({ request, body }) => {
    const doctorId = doctorIdFromUrl(request);
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { id: true, clinicId: true },
    });
    if (!doctor) return notFound();

    type Assignment = {
      priceOverride: number | null;
      durationMinOverride: number | null;
    };
    // De-dup by serviceId in case the client sends duplicates; later
    // entries win.
    const dedup = new Map<string, Assignment>();
    for (const a of body.assignments) {
      dedup.set(a.serviceId, {
        priceOverride: a.priceOverride ?? null,
        durationMinOverride: a.durationMinOverride ?? null,
      });
    }

    // Validate all referenced services belong to this clinic and exist.
    // The tenant-scope Prisma extension already filters by clinicId, but we
    // still want a clean 404-ish response when the client sends a bad id.
    const serviceIds = [...dedup.keys()];
    if (serviceIds.length > 0) {
      const found = await prisma.service.findMany({
        where: { id: { in: serviceIds } },
        select: { id: true },
      });
      if (found.length !== serviceIds.length) {
        return notFound();
      }
    }

    await prisma.$transaction([
      prisma.serviceOnDoctor.deleteMany({ where: { doctorId } }),
      prisma.serviceOnDoctor.createMany({
        data: [...dedup.entries()].map(([serviceId, ov]) => ({
          doctorId,
          serviceId,
          priceOverride: ov.priceOverride,
          durationMinOverride: ov.durationMinOverride,
        })) as never,
      }),
    ]);

    const rows = await prisma.serviceOnDoctor.findMany({
      where: { doctorId },
      include: {
        service: {
          select: {
            id: true,
            code: true,
            nameRu: true,
            nameUz: true,
            durationMin: true,
            priceBase: true,
            isActive: true,
          },
        },
      },
      orderBy: { service: { nameRu: "asc" } },
    });

    await audit(request, {
      action: "doctor.services.update",
      entityType: "Doctor",
      entityId: doctorId,
      meta: { count: rows.length, serviceIds },
    });

    return ok({
      rows: rows.map((r) => ({
        serviceId: r.serviceId,
        service: r.service,
        priceOverride: r.priceOverride,
        durationMinOverride: r.durationMinOverride,
      })),
    });
  }
);
