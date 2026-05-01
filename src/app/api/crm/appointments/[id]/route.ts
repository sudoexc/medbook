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
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";
import {
  canTransition,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";

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

    if (
      body.status !== undefined &&
      !canTransition(
        before.status as AppointmentStatus,
        body.status as AppointmentStatus,
      )
    ) {
      return conflict("invalid_transition", {
        from: before.status,
        to: body.status,
      });
    }

    // If any time/doctor change, re-run conflict detection. Cabinet is no
    // longer client-controlled (Phase 11 binding) — when doctorId changes we
    // re-derive cabinet from the new doctor, otherwise keep before.cabinetId.
    const timeChanged =
      body.date !== undefined ||
      body.time !== undefined ||
      body.durationMin !== undefined ||
      body.doctorId !== undefined;

    let startAt = before.date;
    let endAt = before.endDate;
    let nextCabinetId: string | null = before.cabinetId;
    if (body.doctorId !== undefined && body.doctorId !== before.doctorId) {
      const newDoc = await prisma.doctor.findUnique({
        where: { id: body.doctorId },
        select: { cabinetId: true, isActive: true },
      });
      if (!newDoc || !newDoc.isActive) {
        return conflict("doctor_not_found");
      }
      nextCabinetId = newDoc.cabinetId;
    }

    if (timeChanged) {
      const date = body.date ?? before.date;
      const time = body.time === undefined ? before.time : body.time;
      const dur = body.durationMin ?? before.durationMin;
      startAt = applyTime(date, time);
      endAt = computeEndDate(startAt, dur);
      const doctorId = body.doctorId ?? before.doctorId;
      const c = await detectConflicts({
        doctorId,
        cabinetId: nextCabinetId,
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
    if (body.doctorId !== undefined && body.doctorId !== before.doctorId) {
      data.cabinetId = nextCabinetId;
    }
    if (body.status === "CANCELLED" && !before.cancelledAt) {
      data.cancelledAt = new Date();
    }
    if (body.status === "COMPLETED" && !before.completedAt) {
      const now = new Date();
      data.completedAt = now;
      // Mirror the queue-status route: when the visit completes ahead of the
      // booked end, shrink the slot so the freed tail is bookable. Skip if
      // the caller is also moving the time in this same PATCH (timeChanged
      // path already recomputed endDate).
      if (!timeChanged) {
        const minEnd = new Date(before.date.getTime() + 5 * 60_000);
        const newEnd = now < minEnd ? minEnd : now;
        if (newEnd < before.endDate) {
          data.endDate = newEnd;
          data.durationMin = Math.max(
            5,
            Math.round((newEnd.getTime() - before.date.getTime()) / 60_000),
          );
        }
      }
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

    // Realtime fan-out. Pick the event type that best reflects the change:
    //   - status transition  → appointment.statusChanged
    //   - time/doctor move   → appointment.moved
    //   - cancelled          → appointment.cancelled
    //   - otherwise          → appointment.updated
    const tenant = getTenant();
    const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
    if (clinicId) {
      const statusChanged =
        body.status !== undefined && body.status !== before.status;
      const basePayload = {
        appointmentId: id,
        doctorId: after.doctorId,
        patientId: after.patientId,
        cabinetId: after.cabinetId,
        status: after.status,
        previousStatus: before.status,
        date: after.date.toISOString(),
      };
      if (body.status === "CANCELLED") {
        publishEventSafe(clinicId, {
          type: "appointment.cancelled",
          payload: basePayload,
        });
      } else if (statusChanged) {
        publishEventSafe(clinicId, {
          type: "appointment.statusChanged",
          payload: basePayload,
        });
      } else if (timeChanged) {
        publishEventSafe(clinicId, {
          type: "appointment.moved",
          payload: basePayload,
        });
      } else {
        publishEventSafe(clinicId, {
          type: "appointment.updated",
          payload: basePayload,
        });
      }
      // Queue snapshot (shown on reception dashboard) typically shifts on
      // any status change too.
      if (statusChanged) {
        publishEventSafe(clinicId, {
          type: "queue.updated",
          payload: {
            appointmentId: id,
            doctorId: after.doctorId,
            queueStatus: after.queueStatus,
            previousStatus: before.queueStatus,
          },
        });
      }
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

    const tenant = getTenant();
    const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
    if (clinicId) {
      publishEventSafe(clinicId, {
        type: "appointment.cancelled",
        payload: {
          appointmentId: id,
          doctorId: cancelled.doctorId,
          patientId: cancelled.patientId,
          cabinetId: cancelled.cabinetId,
          status: cancelled.status,
          date: cancelled.date.toISOString(),
        },
      });
    }
    return ok({ id, cancelled: true });
  }
);
