/**
 * /api/crm/notifications/sends/[id]/cancel — cancel a queued send.
 *
 * Only QUEUED rows are cancellable; once SENT/DELIVERED the message has
 * already left the system. Sets `status` to CANCELLED and stamps a
 * `failedReason` describing the user-initiated cancel so audit + UI keep
 * a paper trail.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../sends/[id]/cancel
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.notificationSend.findUnique({ where: { id } });
    if (!before) return notFound();
    if (before.status !== "QUEUED") {
      return err("notification.cancel.only_queued", 400);
    }
    const after = await prisma.notificationSend.update({
      where: { id },
      data: {
        status: "CANCELLED",
        failedReason: "cancelled_by_user",
      },
    });
    await audit(request, {
      action: "send.cancel",
      entityType: "NotificationSend",
      entityId: id,
      meta: { before: before.status, after: after.status },
    });
    return ok(after);
  },
);
