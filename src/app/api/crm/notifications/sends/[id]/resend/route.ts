/**
 * /api/crm/notifications/sends/[id]/resend — clone a send and re-queue.
 *
 * Differs from `retry` in two ways: `retry` only works for FAILED (or
 * abandoned SENDING) rows and requeues the existing row in place. `resend`
 * creates a brand-new row, so the original record stays intact for audit.
 * The new row inherits template, recipient, channel and body; scheduledFor
 * is `now`. It also inherits the appointment start the original was written
 * for (`appointmentAt`), so the send worker still cancels a reminder whose
 * appointment has moved, and only that one (audit TG-08). A row being sent
 * right now (SENDING) is refused: the clone would race the live send.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err } from "@/server/http";
import { pinnedAnchor } from "@/server/notifications/delivery-state";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../sends/[id]/resend
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const original = await prisma.notificationSend.findUnique({
      where: { id },
      include: { template: { select: { trigger: true, triggerConfig: true } } },
    });
    if (!original) return notFound();
    if (original.status === "QUEUED") {
      return err("notification.resend.already_queued", 400);
    }
    if (original.status === "SENDING") {
      return err("notification.resend.in_flight", 409);
    }
    const clone = await prisma.notificationSend.create({
      data: {
        clinicId: original.clinicId,
        templateId: original.templateId,
        campaignId: original.campaignId,
        patientId: original.patientId,
        appointmentId: original.appointmentId,
        caseId: original.caseId,
        channel: original.channel,
        recipient: original.recipient,
        body: original.body,
        status: "QUEUED",
        scheduledFor: new Date(),
        appointmentAt:
          original.appointmentAt ?? pinnedAnchor(original).appointmentAt ?? null,
      },
    });
    await audit(request, {
      action: "send.resend",
      entityType: "NotificationSend",
      entityId: clone.id,
      meta: { sourceId: id, channel: original.channel },
    });
    return ok(clone, 201);
  },
);
