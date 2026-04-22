/**
 * /api/crm/notifications/sends/[id]/retry — requeue a failed send.
 * See docs/TZ.md §6.4.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../sends/[id]/retry
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.notificationSend.findUnique({ where: { id } });
    if (!before) return notFound();
    const after = await prisma.notificationSend.update({
      where: { id },
      data: {
        status: "QUEUED",
        failedReason: null,
        retryCount: { increment: 1 },
        scheduledFor: new Date(),
      },
    });
    await audit(request, {
      action: "send.retry",
      entityType: "NotificationSend",
      entityId: id,
      meta: { before: before.status, after: after.status },
    });
    return ok(after);
  }
);
