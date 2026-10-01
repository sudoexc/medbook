/**
 * /api/crm/doctors/[id]/online-service — the service a Mini App booking with
 * this doctor is made for (audit MA-08).
 *
 * GET returns the stored pick, the doctor's linked services and what the
 * Mini App will actually do (`resolveOnlineService`): book the picked
 * service, book the only active one, or not offer the doctor online.
 *
 * PUT `{ serviceId: string | null }` (ADMIN) stores the pick. It must be one
 * of the doctor's ACTIVE linked services; null clears it. The pick lives on
 * the doctor, so replacing his service links (services tab, doctor PATCH,
 * service PATCH) never drops it silently: a pick that is no longer an
 * active link is simply not honoured, and GET says so.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, notFound, ok } from "@/server/http";
import { resolveOnlineService } from "@/lib/doctors/online-service";

const BodySchema = z.object({
  serviceId: z.string().min(1).max(64).nullable(),
});

function doctorIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../doctors/[id]/online-service
  return parts[parts.length - 2] ?? "";
}

async function loadState(doctorId: string) {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: {
      id: true,
      onlineServiceId: true,
      services: {
        select: {
          service: {
            select: { id: true, nameRu: true, nameUz: true, isActive: true },
          },
        },
        orderBy: { service: { nameRu: "asc" } },
      },
    },
  });
  if (!doctor) return null;
  const services = doctor.services.map((l) => l.service);
  const resolution = resolveOnlineService(
    doctor.onlineServiceId,
    services.map((s) => ({ serviceId: s.id, isActive: s.isActive })),
  );
  return { onlineServiceId: doctor.onlineServiceId, services, resolution };
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const state = await loadState(doctorIdFromUrl(request));
    if (!state) return notFound();
    return ok(state);
  },
);

export const PUT = createApiHandler(
  { roles: ["ADMIN"], bodySchema: BodySchema },
  async ({ request, body }) => {
    const doctorId = doctorIdFromUrl(request);
    const before = await loadState(doctorId);
    if (!before) return notFound();

    if (body.serviceId !== null) {
      const link = before.services.find((s) => s.id === body.serviceId);
      if (!link || !link.isActive) {
        return err("service_not_offered", 422, { reason: "service_not_offered" });
      }
    }

    await prisma.doctor.update({
      where: { id: doctorId },
      data: { onlineServiceId: body.serviceId },
    });
    await audit(request, {
      action: "doctor.online_service.update",
      entityType: "Doctor",
      entityId: doctorId,
      meta: { from: before.onlineServiceId, to: body.serviceId },
    });

    const after = await loadState(doctorId);
    return ok(after);
  },
);
