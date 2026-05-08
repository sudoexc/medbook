/**
 * POST /api/crm/actions/[id]/done — user actioned this and the underlying
 * issue is resolved. Sets `doneAt = now` and `status='DONE'`.
 *
 * RBAC: ADMIN, RECEPTIONIST, DOCTOR. See dismiss/route.ts for the DOCTOR
 * rationale (Wave 2 will tighten with row-level ownership checks).
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { DoneActionSchema } from "@/server/schemas/action";
import { actionIdFromUrl } from "@/server/actions/handler-utils";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: DoneActionSchema,
  },
  async ({ request }) => {
    const id = actionIdFromUrl(request);

    const before = await prisma.action.findUnique({ where: { id } });
    if (!before) return notFound();

    const now = new Date();
    const after = await prisma.action.update({
      where: { id },
      data: {
        doneAt: now,
        status: "DONE",
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.ACTION_DONE,
      entityType: "Action",
      entityId: id,
      meta: {
        type: before.type,
        payload: before.payload,
        oldStatus: before.status,
        newStatus: "DONE",
        doneAt: now.toISOString(),
      },
    });

    return ok(after);
  },
);
