/**
 * GET /api/crm/campaigns/[id] — fetch a single campaign with its template +
 * a small status histogram of its NotificationSend children. Used by the
 * detail panel and the post-launch confirmation screen.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, notFound } from "@/server/http";

function campaignIdFromUrl(request: Request): string {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  // Path shape: ["api", "crm", "campaigns", "<id>"]
  return segments[segments.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST"] },
  async ({ request }) => {
    const id = campaignIdFromUrl(request);
    if (!id) return notFound();

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        template: { select: { id: true, nameRu: true, nameUz: true, key: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!campaign) return notFound();

    const sendsGrouped = await prisma.notificationSend.groupBy({
      by: ["status"],
      where: { campaignId: id },
      _count: { _all: true },
    });
    const sendsByStatus = Object.fromEntries(
      sendsGrouped.map((g) => [g.status, g._count._all]),
    );

    return ok({ campaign, sendsByStatus });
  },
);
