/**
 * POST /api/crm/campaigns/[id]/cancel — stop a scheduled (future-dated)
 * broadcast before its dispatch time (TZ-telegram-section.md Layer 3).
 *
 * A deferred broadcast is launched immediately (status SENDING, startedAt
 * stamped) but its NotificationSend rows sit QUEUED with a future
 * `scheduledFor` until the notifications scheduler picks them up. Cancelling
 * flips those pending rows to CANCELLED so the scheduler skips them, and marks
 * the Campaign CANCELLED.
 *
 * Idempotent: cancelling an already-CANCELLED campaign is a 200 no-op. A
 * broadcast that is not scheduled (already sending/done, or immediate) is not
 * cancellable — there is nothing future to stop — and returns 409.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";

function campaignIdFromUrl(request: Request): string {
  // /api/crm/campaigns/<id>/cancel — id is the second-to-last segment.
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments[segments.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const id = campaignIdFromUrl(request);
    if (!id) return notFound();

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, scheduledFor: true },
    });
    if (!campaign) return notFound();

    if (campaign.status === "CANCELLED") {
      return ok({ campaignId: id, alreadyCancelled: true, cancelledSends: 0 });
    }

    const now = new Date();
    const isScheduled =
      campaign.scheduledFor !== null && campaign.scheduledFor.getTime() > now.getTime();
    if (!isScheduled) {
      return err("BroadcastNotScheduled", 409);
    }

    const cancelledSends = await prisma.$transaction(async (tx) => {
      const flipped = await tx.notificationSend.updateMany({
        where: {
          clinicId: ctx.clinicId,
          campaignId: id,
          status: "QUEUED",
          scheduledFor: { gt: now },
        },
        data: { status: "CANCELLED" },
      });

      await tx.campaign.update({
        where: { id },
        data: { status: "CANCELLED", finishedAt: now },
      });

      return flipped.count;
    });

    await audit(request, {
      action: AUDIT_ACTION.CAMPAIGN_CANCELLED,
      entityType: "Campaign",
      entityId: id,
      meta: { name: campaign.name, cancelledSends },
    });

    return ok({ campaignId: id, alreadyCancelled: false, cancelledSends });
  },
);
