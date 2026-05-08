/**
 * POST /api/crm/actions/[id]/reopen — admin override that resurrects a
 * DONE / DISMISSED / EXPIRED action back to OPEN. Used when the underlying
 * problem turns out to still be live.
 *
 * RBAC: ADMIN-only (per spec). RECEPTIONIST gets 403 from the wrapper.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ReopenActionSchema } from "@/server/schemas/action";
import { actionIdFromUrl } from "@/server/actions/handler-utils";

export const POST = createApiHandler(
  {
    roles: ["ADMIN"],
    bodySchema: ReopenActionSchema,
  },
  async ({ request }) => {
    const id = actionIdFromUrl(request);

    const before = await prisma.action.findUnique({ where: { id } });
    if (!before) return notFound();

    const after = await prisma.action.update({
      where: { id },
      data: {
        status: "OPEN",
        doneAt: null,
        dismissedAt: null,
        snoozeUntil: null,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.ACTION_REOPENED,
      entityType: "Action",
      entityId: id,
      meta: {
        type: before.type,
        payload: before.payload,
        oldStatus: before.status,
        newStatus: "OPEN",
      },
    });

    return ok(after);
  },
);
