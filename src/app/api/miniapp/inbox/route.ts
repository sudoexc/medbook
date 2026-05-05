/**
 * GET /api/miniapp/inbox?clinicSlug=…
 *
 * Returns unread INAPP NotificationSend rows for the authenticated patient,
 * newest first. Used by the Mini App banner / inbox screen.
 *
 * "Unread" = `channel=INAPP` AND `status IN (SENT, DELIVERED)` AND
 * `readAt IS NULL`. The matching index is
 * `(patientId, channel, status, readAt)` — added in the
 * `inapp_case_repeat` migration — so the lookup is ix-only.
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";

const MAX_ITEMS = 50;

export const GET = createMiniAppListHandler({}, async ({ ctx }) => {
  const rows = await prisma.notificationSend.findMany({
    where: {
      patientId: ctx.patientId,
      clinicId: ctx.clinicId,
      channel: "INAPP",
      status: { in: ["SENT", "DELIVERED", "READ"] },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ITEMS,
    select: {
      id: true,
      body: true,
      status: true,
      createdAt: true,
      readAt: true,
      appointmentId: true,
      caseId: true,
      template: { select: { key: true, category: true } },
    },
  });

  const items = rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : null,
    appointmentId: r.appointmentId,
    caseId: r.caseId,
    templateKey: r.template?.key ?? null,
    category: r.template?.category ?? null,
  }));
  const unreadCount = items.filter((i) => i.readAt === null).length;
  return ok({ items, unreadCount });
});
