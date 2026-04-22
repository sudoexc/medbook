/**
 * PATCH/DELETE /api/miniapp/appointments/[id]?clinicSlug=…
 *
 * Reschedule (startAt, doctorId?, serviceIds?) or cancel the patient's own
 * appointment. Both verbs are scoped to the authenticated patient — a
 * patient cannot touch another patient's rows.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { conflict, err, notFound, ok } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import {
  computeEndDate,
  detectConflicts,
} from "@/server/services/appointments";
import { fireTrigger } from "@/server/notifications/triggers";

const PatchBody = z
  .object({
    startAt: z.string().datetime().optional(),
    doctorId: z.string().optional(),
    serviceIds: z.array(z.string()).optional(),
    cancel: z.boolean().optional(),
  })
  .refine(
    (v) => v.startAt || v.doctorId || v.serviceIds || v.cancel,
    { message: "nothing_to_update" },
  );

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createMiniAppHandler(
  { bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.appointment.findFirst({
      where: { id, clinicId: ctx.clinicId, patientId: ctx.patientId },
    });
    if (!before) return notFound();
    if (
      before.status === "COMPLETED" ||
      before.status === "IN_PROGRESS" ||
      before.status === "CANCELLED"
    ) {
      return err("not_editable", 409);
    }

    if (body.cancel) {
      const cancelled = await prisma.appointment.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      fireTrigger({ kind: "appointment.cancelled", appointmentId: id });
      return ok({ appointment: cancelled });
    }

    const doctorId = body.doctorId ?? before.doctorId;
    let startAt = before.date;
    let endAt = before.endDate;
    let durationMin = before.durationMin;
    let priceBase = before.priceBase ?? 0;

    if (body.serviceIds && body.serviceIds.length > 0) {
      const services = await prisma.service.findMany({
        where: {
          id: { in: body.serviceIds },
          clinicId: ctx.clinicId,
          isActive: true,
        },
        select: { id: true, priceBase: true, durationMin: true },
      });
      if (services.length !== body.serviceIds.length) {
        return err("service_not_found", 404);
      }
      durationMin = services.reduce((a, s) => a + s.durationMin, 0) || 30;
      priceBase = services.reduce((a, s) => a + s.priceBase, 0);
    }
    if (body.startAt) {
      const next = new Date(body.startAt);
      if (Number.isNaN(next.getTime())) return err("bad_start_at", 400);
      startAt = next;
      endAt = computeEndDate(startAt, durationMin);
    } else if (body.serviceIds) {
      endAt = computeEndDate(startAt, durationMin);
    }

    const c = await detectConflicts({
      doctorId,
      cabinetId: before.cabinetId,
      startAt,
      endAt,
      excludeId: id,
    });
    if (!c.ok) {
      return conflict(c.reason, c.until ? { until: c.until } : undefined);
    }

    const time = `${String(startAt.getHours()).padStart(2, "0")}:${String(
      startAt.getMinutes(),
    ).padStart(2, "0")}`;

    const updated = await prisma.$transaction(async (tx) => {
      if (body.serviceIds) {
        await tx.appointmentService.deleteMany({
          where: { appointmentId: id },
        });
        const services = await tx.service.findMany({
          where: { id: { in: body.serviceIds } },
          select: { id: true, priceBase: true },
        });
        const priceMap = new Map(services.map((s) => [s.id, s.priceBase]));
        await tx.appointmentService.createMany({
          data: body.serviceIds.map((sid) => ({
            clinicId: ctx.clinicId,
            appointmentId: id,
            serviceId: sid,
            priceSnap: priceMap.get(sid) ?? 0,
            quantity: 1,
          })) as never,
        });
      }
      return tx.appointment.update({
        where: { id },
        data: {
          doctorId,
          serviceId: body.serviceIds?.[0] ?? before.serviceId,
          date: startAt,
          time,
          durationMin,
          endDate: endAt,
          priceBase,
          priceService: priceBase,
          priceFinal: priceBase,
        } as never,
      });
    });

    fireTrigger({ kind: "appointment.updated", appointmentId: id });
    return ok({ appointment: updated });
  },
);

export const DELETE = createMiniAppHandler({}, async ({ request, ctx }) => {
  const id = idFromUrl(request);
  const before = await prisma.appointment.findFirst({
    where: { id, clinicId: ctx.clinicId, patientId: ctx.patientId },
  });
  if (!before) return notFound();
  if (before.status === "CANCELLED") return ok({ appointment: before });
  const cancelled = await prisma.appointment.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  fireTrigger({ kind: "appointment.cancelled", appointmentId: id });
  return ok({ appointment: cancelled });
});
