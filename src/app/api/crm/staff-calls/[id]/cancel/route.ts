/**
 * POST /api/crm/staff-calls/[id]/cancel — the doctor takes his call back
 * («Отменить»): the reception screens close it.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { STAFF_CALL_CALLER_ROLES } from "@/lib/staff-calls";
import { err, notFound, ok } from "@/server/http";
import { loadStaffCall, publishStaffCall } from "@/server/staff-calls";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../staff-calls/[id]/cancel
  return decodeURIComponent(parts[parts.length - 2] ?? "");
}

export const POST = createApiHandler(
  { roles: [...STAFF_CALL_CALLER_ROLES] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const id = idFromUrl(request);
    if (!id) return notFound();
    const doctor = await prisma.doctor.findFirst({ where: { userId: ctx.userId }, select: { id: true } });
    if (!doctor) return notFound();
    const now = new Date();
    const done = await prisma.staffCall.updateMany({
      where: { id, doctorId: doctor.id, status: "OPEN" },
      data: { status: "CANCELLED", closedAt: now },
    });
    const call = await loadStaffCall(id);
    if (!call || call.doctorId !== doctor.id) return notFound();
    if (done.count > 0) publishStaffCall(ctx.clinicId, call);
    return ok({ call });
  },
);
