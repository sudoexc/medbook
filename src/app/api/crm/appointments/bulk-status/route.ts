/**
 * /api/crm/appointments/bulk-status — change status for many at once.
 * See docs/TZ.md §6.2 bulk actions.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, conflict } from "@/server/http";
import { BulkStatusSchema } from "@/server/schemas/appointment";
import {
  canTransition,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: BulkStatusSchema,
  },
  async ({ request, body }) => {
    const now = new Date();
    const target = body.status as AppointmentStatus;

    // Pre-flight: refuse the whole batch if any selected row can't reach the
    // target status. The UI should already prevent this, but the server is
    // the source of truth — kiosks, scripts, or stale tabs may still try.
    const existing = await prisma.appointment.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, status: true },
    });
    const blocked = existing.filter(
      (a) => !canTransition(a.status as AppointmentStatus, target),
    );
    if (blocked.length > 0) {
      return conflict("invalid_transition", {
        to: target,
        blocked: blocked.map((a) => ({ id: a.id, from: a.status })),
      });
    }

    const data: Record<string, unknown> = { status: target };
    if (target === "CANCELLED") {
      data.cancelledAt = now;
      if (body.cancelReason) data.cancelReason = body.cancelReason;
    }
    if (target === "COMPLETED") data.completedAt = now;

    const result = await prisma.appointment.updateMany({
      where: { id: { in: body.ids } },
      data,
    });
    await audit(request, {
      action: "appointment.bulk-status",
      entityType: "Appointment",
      meta: { ids: body.ids, status: target, count: result.count },
    });
    return ok({ count: result.count });
  }
);
