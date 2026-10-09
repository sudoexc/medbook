/**
 * POST /api/crm/staff-calls/[id]/ack — «Иду»: someone at the desk takes
 * the doctor's call. Conditional on the call still ringing, so of two
 * receptionists pressing at once one wins and the other is told who goes;
 * every reception screen closes it and the doctor sees the name.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { STAFF_CALL_ANSWER_ROLES, staffCallOpenSince } from "@/lib/staff-calls";
import { err, notFound, ok } from "@/server/http";
import { loadStaffCall, publishStaffCall } from "@/server/staff-calls";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../staff-calls/[id]/ack
  return decodeURIComponent(parts[parts.length - 2] ?? "");
}

export const POST = createApiHandler(
  { roles: [...STAFF_CALL_ANSWER_ROLES] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const id = idFromUrl(request);
    if (!id) return notFound();
    const me = await prisma.user.findFirst({ where: { id: ctx.userId }, select: { name: true } });
    const now = new Date();
    const taken = await prisma.staffCall.updateMany({
      where: { id, status: "OPEN", createdAt: { gte: staffCallOpenSince(now) } },
      data: { status: "ACKED", ackedById: ctx.userId, ackedByName: me?.name ?? null, ackedAt: now, closedAt: now },
    });
    const call = await loadStaffCall(id);
    if (!call) return notFound();
    if (taken.count === 0) {
      // Someone else answered first, the doctor took it back, or it expired.
      return err("StaffCallClosed", 409, { reason: "staff_call_closed", call });
    }
    publishStaffCall(ctx.clinicId, call);
    return ok({ call });
  },
);
