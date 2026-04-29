/**
 * /api/crm/appointments/[id]/queue-status — set queueStatus + side-effects.
 * See docs/TZ.md §6.1 queue.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, conflict } from "@/server/http";
import { QueueStatusUpdateSchema } from "@/server/schemas/appointment";
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";
import {
  canTransition,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../appointments/[id]/queue-status
  return parts[parts.length - 2] ?? "";
}

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"],
    bodySchema: QueueStatusUpdateSchema,
  },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.appointment.findUnique({ where: { id } });
    if (!before) return notFound();

    // This endpoint is the queue lifecycle: BOOKED → WAITING → IN_PROGRESS
    // → COMPLETED. Source of truth is `queueStatus`, not `status` — they
    // can drift out of sync if a row was edited through legacy paths or
    // direct DB mutation. We then re-sync both in the update below.
    const fromStatus = before.queueStatus as AppointmentStatus;
    if (
      !canTransition(fromStatus, body.queueStatus as AppointmentStatus)
    ) {
      return conflict("invalid_transition", {
        from: before.queueStatus,
        to: body.queueStatus,
      });
    }

    const data: Record<string, unknown> = {
      queueStatus: body.queueStatus,
      status: body.queueStatus,
    };
    const now = new Date();
    if (body.queueStatus === "IN_PROGRESS" && !before.startedAt) {
      data.startedAt = now;
    }
    if (body.queueStatus === "COMPLETED" && !before.completedAt) {
      data.completedAt = now;
      // Shrink the slot if the visit ended before the originally booked end —
      // this releases the tail of the slot for walk-ins and re-bookings, and
      // makes the calendar block reflect actual occupancy. Floor at start +
      // 5 min so we never end up with a zero/negative-duration row that
      // would surprise the EXCLUDE constraint or downstream UI.
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

    const after = await prisma.appointment.update({ where: { id }, data });
    await audit(request, {
      action: "appointment.queue-status",
      entityType: "Appointment",
      entityId: id,
      meta: { before: before.queueStatus, after: after.queueStatus },
    });

    const tenant = getTenant();
    const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
    if (clinicId) {
      publishEventSafe(clinicId, {
        type: "queue.updated",
        payload: {
          appointmentId: id,
          doctorId: after.doctorId,
          queueStatus: after.queueStatus,
          previousStatus: before.queueStatus,
        },
      });
      publishEventSafe(clinicId, {
        type: "appointment.statusChanged",
        payload: {
          appointmentId: id,
          doctorId: after.doctorId,
          status: after.status,
          previousStatus: before.status,
        },
      });
      if (after.endDate.getTime() !== before.endDate.getTime()) {
        publishEventSafe(clinicId, {
          type: "appointment.updated",
          payload: {
            appointmentId: id,
            doctorId: after.doctorId,
            status: after.status,
            date: after.date.toISOString(),
            endDate: after.endDate.toISOString(),
          },
        });
      }
    }
    return ok(after);
  }
);
