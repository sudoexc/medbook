/**
 * POST /api/crm/actions/[id]/dismiss — user explicitly silences this action
 * without acting on it. Sets `dismissedAt = now` and `status='DISMISSED'`.
 *
 * RBAC: ADMIN, RECEPTIONIST, DOCTOR. DOCTOR is allowed because the spec
 * permits the assigned doctor to dismiss; richer per-row ownership checks
 * land in Wave 2 once detectors stamp doctorId on relevant rows.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { DismissActionSchema } from "@/server/schemas/action";
import { actionIdFromUrl } from "@/server/actions/handler-utils";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: DismissActionSchema,
  },
  async ({ request, body }) => {
    const id = actionIdFromUrl(request);

    const before = await prisma.action.findUnique({ where: { id } });
    if (!before) return notFound();

    const now = new Date();
    const after = await prisma.action.update({
      where: { id },
      data: {
        dismissedAt: now,
        status: "DISMISSED",
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.ACTION_DISMISSED,
      entityType: "Action",
      entityId: id,
      meta: {
        type: before.type,
        payload: before.payload,
        oldStatus: before.status,
        newStatus: "DISMISSED",
        dismissedAt: now.toISOString(),
        reason: body.reason ?? null,
      },
    });

    return ok(after);
  },
);
