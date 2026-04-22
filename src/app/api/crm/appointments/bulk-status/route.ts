/**
 * /api/crm/appointments/bulk-status — change status for many at once.
 * See docs/TZ.md §6.2 bulk actions.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok } from "@/server/http";
import { BulkStatusSchema } from "@/server/schemas/appointment";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: BulkStatusSchema,
  },
  async ({ request, body }) => {
    const now = new Date();
    const data: Record<string, unknown> = { status: body.status };
    if (body.status === "CANCELLED") {
      data.cancelledAt = now;
      if (body.cancelReason) data.cancelReason = body.cancelReason;
    }
    if (body.status === "COMPLETED") data.completedAt = now;

    const result = await prisma.appointment.updateMany({
      where: { id: { in: body.ids } },
      data,
    });
    await audit(request, {
      action: "appointment.bulk-status",
      entityType: "Appointment",
      meta: { ids: body.ids, status: body.status, count: result.count },
    });
    return ok({ count: result.count });
  }
);
