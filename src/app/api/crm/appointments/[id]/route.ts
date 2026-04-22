/**
 * /api/crm/appointments/[id] — get, patch (status/time/doctor reschedule),
 * delete (soft cancel). See docs/TZ.md §6.2, §6.3.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, conflict, forbidden, diff } from "@/server/http";
import { UpdateAppointmentSchema } from "@/server/schemas/appointment";
import {
  applyTime,
  computeEndDate,
  detectConflicts,
} from "@/server/services/appointments";
import { fireTrigger } from "@/server/notifications/triggers";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const row = await prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: true,
        doctor: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            userId: true,
            color: true,
            photoUrl: true,
          },
        },
        cabinet: true,
        primaryService: true,
        services: { include: { service: true } },
        payments: true,
      },
    });
    if (!row) return notFound();
    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      row.doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: UpdateAppointmentSchema,
  },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.appointment.findUnique({
      where: { id },
      include: { doctor: { select: { userId: true } } },
    });
    if (!before) return notFound();

    if (
      ctx.kind === "TENANT" &&
      ctx.role === "DOCTOR" &&
      before.doctor.userId !== ctx.userId
    ) {
      return forbidden();
    }

    // If any time/doctor/cabinet changed, re-run conflict detection.
    const timeChanged =
      body.date !== undefined ||
      body.time !== undefined ||
      body.durationMin !== undefined ||
      body.doctorId !== undefined ||
      body.cabinetId !== undefined;

    let startAt = before.date;
    let endAt = before.endDate;
    if (timeChanged) {
      const date = body.date ?? before.date;
      const time = body.time === undefined ? before.time : body.time;
      const dur = body.durationMin ?? before.durationMin;
      startAt = applyTime(date, time);
      endAt = computeEndDate(startAt, dur);
      const doctorId = body.doctorId ?? before.doctorId;
      const cabinetId =
        body.cabinetId === undefined ? before.cabinetId : body.cabinetId;
      const c = await detectConflicts({
        doctorId,
        cabinetId,
        startAt,
        endAt,
        excludeId: id,
      });
      if (!c.ok) {
        return conflict(c.reason, c.until ? { until: c.until } : undefined);
      }
    }

    const data: Record<string, unknown> = { ...body };
    if (timeChanged) {
      data.date = startAt;
      data.endDate = endAt;
    }
    if (body.status === "CANCELLED" && !before.cancelledAt) {
      data.cancelledAt = new Date();
    }
    if (body.status === "COMPLETED" && !before.completedAt) {
      data.completedAt = new Date();
    }
    if (body.status === "IN_PROGRESS" && !before.startedAt) {
      data.startedAt = new Date();
    }

    // Replace AppointmentService join rows if body.services provided.
    const services = body.services;
    delete (data as { services?: unknown }).services;

    const after = await prisma.$transaction(async (tx) => {
      if (services !== undefined) {
        await tx.appointmentService.deleteMany({
          where: { appointmentId: id },
        });
        if (services.length > 0) {
          const svcRows = await tx.service.findMany({
            where: { id: { in: services.map((s) => s.serviceId) } },
            select: { id: true, priceBase: true },
          });
          const priceMap = new Map(svcRows.map((s) => [s.id, s.priceBase]));
          await tx.appointmentService.createMany({
            data: services.map((s) => ({
              appointmentId: id,
              serviceId: s.serviceId,
              priceSnap: s.priceOverride ?? priceMap.get(s.serviceId) ?? 0,
              quantity: s.quantity ?? 1,
            })) as never,
          });
        }
      }
      return tx.appointment.update({ where: { id }, data: data as never });
    });

    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "appointment.update",
      entityType: "Appointment",
      entityId: id,
      meta: d,
    });
    // Phase 3a notification triggers.
    if (body.status === "CANCELLED") {
      fireTrigger({ kind: "appointment.cancelled", appointmentId: id });
    } else if (body.status === "NO_SHOW") {
      fireTrigger({ kind: "appointment.noshow", appointmentId: id });
    } else if (timeChanged) {
      fireTrigger({ kind: "appointment.updated", appointmentId: id });
    }
    return ok(after);
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.appointment.findUnique({ where: { id } });
    if (!before) return notFound();
    const cancelled = await prisma.appointment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });
    await audit(request, {
      action: "appointment.cancel",
      entityType: "Appointment",
      entityId: id,
      meta: { before, after: cancelled },
    });
    fireTrigger({ kind: "appointment.cancelled", appointmentId: id });
    return ok({ id, cancelled: true });
  }
);
