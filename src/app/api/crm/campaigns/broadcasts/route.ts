/**
 * GET /api/crm/campaigns/broadcasts — broadcast ("рассылка") history with a
 * delivery funnel per campaign (TZ-telegram-section.md Layer 3).
 *
 * Only inline-body broadcasts (`body != null`) are listed — template-backed
 * dormant campaigns live in the reactivation wizard. The funnel is computed
 * with two `groupBy` passes over the page's campaign ids (no N+1):
 *   1. status histogram → queued / sent / delivered / read / failed
 *   2. FAILED rows whose `failedReason` looks like a block → `blocked`
 *      (a subset peeled out of `failed` so the two sum cleanly).
 *
 * Scheduled (future-dated, not yet started) broadcasts are returned first.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";

const MAX_BROADCASTS = 100;

type Funnel = {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  blocked: number;
  total: number;
};

type DerivedStatus = "scheduled" | "sending" | "done" | "cancelled";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST"] },
  async () => {
    const now = new Date();

    const campaigns = await prisma.campaign.findMany({
      where: { body: { not: null } },
      orderBy: { createdAt: "desc" },
      take: MAX_BROADCASTS,
      select: {
        id: true,
        name: true,
        body: true,
        segment: true,
        status: true,
        scheduledFor: true,
        startedAt: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
    });

    if (campaigns.length === 0) return ok({ items: [] });

    const ids = campaigns.map((c) => c.id);

    const [byStatus, blockedRows] = await Promise.all([
      prisma.notificationSend.groupBy({
        by: ["campaignId", "status"],
        where: { campaignId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.notificationSend.groupBy({
        by: ["campaignId"],
        where: {
          campaignId: { in: ids },
          status: "FAILED",
          OR: [
            { failedReason: { contains: "blocked", mode: "insensitive" } },
            { failedReason: { contains: "deactivated", mode: "insensitive" } },
            { failedReason: { contains: "chat not found", mode: "insensitive" } },
          ],
        },
        _count: { _all: true },
      }),
    ]);

    const funnels = new Map<string, Funnel>();
    for (const id of ids) {
      funnels.set(id, {
        queued: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        blocked: 0,
        total: 0,
      });
    }
    for (const row of byStatus) {
      if (!row.campaignId) continue;
      const f = funnels.get(row.campaignId);
      if (!f) continue;
      const n = row._count._all;
      f.total += n;
      switch (row.status) {
        case "QUEUED":
          f.queued += n;
          break;
        case "SENT":
          f.sent += n;
          break;
        case "DELIVERED":
          f.delivered += n;
          break;
        case "READ":
          f.read += n;
          break;
        case "FAILED":
          f.failed += n;
          break;
      }
    }
    for (const row of blockedRows) {
      if (!row.campaignId) continue;
      const f = funnels.get(row.campaignId);
      if (!f) continue;
      f.blocked = row._count._all;
      // Peel blocked out of the raw FAILED bucket so the two don't double-count.
      f.failed = Math.max(0, f.failed - f.blocked);
    }

    const items = campaigns.map((c) => {
      const funnel = funnels.get(c.id)!;
      let status: DerivedStatus;
      if (c.status === "CANCELLED") {
        status = "cancelled";
      } else if (c.scheduledFor && c.scheduledFor > now) {
        // Deferred broadcasts are launched immediately (startedAt is stamped),
        // but delivery waits for the scheduler — so a future scheduledFor, not
        // the absence of startedAt, is what marks a broadcast as "scheduled".
        status = "scheduled";
      } else if (funnel.queued > 0) {
        status = "sending";
      } else {
        status = "done";
      }
      return {
        id: c.id,
        name: c.name,
        body: c.body,
        segment: c.segment,
        scheduledFor: c.scheduledFor,
        startedAt: c.startedAt,
        createdAt: c.createdAt,
        createdByName: c.createdBy?.name ?? null,
        status,
        funnel,
      };
    });

    // Scheduled broadcasts float to the top (soonest first); everything else
    // keeps the newest-first order from the query.
    items.sort((a, b) => {
      const aSched = a.status === "scheduled";
      const bSched = b.status === "scheduled";
      if (aSched && bSched) {
        return (
          new Date(a.scheduledFor!).getTime() -
          new Date(b.scheduledFor!).getTime()
        );
      }
      if (aSched) return -1;
      if (bSched) return 1;
      return 0;
    });

    return ok({ items });
  },
);
