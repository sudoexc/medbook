/**
 * /api/crm/notifications/stats — dashboard aggregates for the notifications
 * center right-rail.
 *
 *   - 30d totals by status (QUEUED / SENT / DELIVERED / READ / FAILED)
 *   - today sent / failed
 *   - active template count
 *   - top templates by usage last 30d
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async () => {
    const now = new Date();
    const in30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const byStatus = await prisma.notificationSend.groupBy({
      by: ["status"],
      where: { createdAt: { gte: in30 } },
      _count: { _all: true },
    });

    const todaySent = await prisma.notificationSend.count({
      where: { sentAt: { gte: startOfToday }, status: { in: ["SENT", "DELIVERED", "READ"] } },
    });
    const todayFailed = await prisma.notificationSend.count({
      where: { createdAt: { gte: startOfToday }, status: "FAILED" },
    });
    const todayQueued = await prisma.notificationSend.count({
      where: { status: "QUEUED" },
    });

    const activeTemplates = await prisma.notificationTemplate.count({
      where: { isActive: true },
    });

    const topRaw = await prisma.notificationSend.groupBy({
      by: ["templateId"],
      where: { createdAt: { gte: in30 }, templateId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { templateId: "desc" } },
      take: 5,
    });
    const tpls = topRaw.length
      ? await prisma.notificationTemplate.findMany({
          where: { id: { in: topRaw.map((r) => r.templateId!).filter(Boolean) } },
          select: { id: true, nameRu: true, nameUz: true },
        })
      : [];
    const tplMap = new Map(tpls.map((t) => [t.id, t]));
    const topTemplates = topRaw.map((r) => ({
      templateId: r.templateId,
      count: r._count._all,
      nameRu: r.templateId ? tplMap.get(r.templateId)?.nameRu ?? null : null,
      nameUz: r.templateId ? tplMap.get(r.templateId)?.nameUz ?? null : null,
    }));

    const total30 = byStatus.reduce((s, r) => s + r._count._all, 0);
    const delivered =
      byStatus.find((r) => r.status === "DELIVERED")?._count._all ?? 0;
    const sent = byStatus.find((r) => r.status === "SENT")?._count._all ?? 0;
    const read = byStatus.find((r) => r.status === "READ")?._count._all ?? 0;
    const failed =
      byStatus.find((r) => r.status === "FAILED")?._count._all ?? 0;
    const queued =
      byStatus.find((r) => r.status === "QUEUED")?._count._all ?? 0;

    return ok({
      last30d: {
        total: total30,
        delivered: delivered + read,
        sent,
        read,
        failed,
        queued,
      },
      today: {
        sent: todaySent,
        failed: todayFailed,
        queued: todayQueued,
      },
      activeTemplates,
      topTemplates,
    });
  },
);
