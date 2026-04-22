/**
 * /api/crm/appointments/[id]/queue-status — set queueStatus + side-effects.
 * See docs/TZ.md §6.1 queue.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";
import { QueueStatusUpdateSchema } from "@/server/schemas/appointment";
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";

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
    }
    return ok(after);
  }
);
