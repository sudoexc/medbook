/**
 * /api/crm/notifications/stats — dashboard aggregates for the notifications
 * center right-rail.
 *
 *   - 30d totals by status over the outbound channels
 *   - today sent / in-app / failed, and the due-now backlog
 *   - active template count
 *   - top templates by usage last 30d
 *
 * Audit TG-06: every Telegram reminder has an in-app mirror row that lands
 * DELIVERED at once, so counting all rows doubled «Отправлено» and made
 * «Доставлено» a count of Mini App banners (Telegram rows never reach
 * DELIVERED: the bot API has no delivery receipts). Outbound KPIs now skip
 * INAPP rows and the banners get their own tile. «Ошибки» counts rows that
 * FAILED today (`failedAt`), not rows created today: a cascade reminder is
 * created days before it fails. «В очереди» is what is due and not yet out,
 * not every reminder planned for the next five days.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { ok } from "@/server/http";

/** Rows that leave the clinic (Telegram today), not the in-app mirrors. */
const OUTBOUND = { channel: { not: "INAPP" as const } };

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async () => {
    const now = new Date();
    const in30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    // "Today" = clinic day (Asia/Tashkent), not server-local midnight.
    const startOfToday = tashkentDayBounds(now).dayStart;

    const byStatus = await prisma.notificationSend.groupBy({
      by: ["status"],
      where: { createdAt: { gte: in30 }, ...OUTBOUND },
      _count: { _all: true },
    });
    const inApp30 = await prisma.notificationSend.count({
      where: {
        createdAt: { gte: in30 },
        channel: "INAPP",
        status: { in: ["DELIVERED", "READ"] },
      },
    });

    const todaySent = await prisma.notificationSend.count({
      where: {
        sentAt: { gte: startOfToday },
        status: { in: ["SENT", "DELIVERED", "READ"] },
        ...OUTBOUND,
      },
    });
    const todayInApp = await prisma.notificationSend.count({
      where: {
        deliveredAt: { gte: startOfToday },
        status: { in: ["DELIVERED", "READ"] },
        channel: "INAPP",
      },
    });
    const todayFailed = await prisma.notificationSend.count({
      where: { failedAt: { gte: startOfToday }, status: "FAILED", ...OUTBOUND },
    });
    const todayQueued = await prisma.notificationSend.count({
      where: {
        status: { in: ["QUEUED", "SENDING"] },
        scheduledFor: { lte: now },
        ...OUTBOUND,
      },
    });

    const activeTemplates = await prisma.notificationTemplate.count({
      where: { isActive: true },
    });

    const topRaw = await prisma.notificationSend.groupBy({
      by: ["templateId"],
      where: { createdAt: { gte: in30 }, templateId: { not: null }, ...OUTBOUND },
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

    const countOf = (status: string) =>
      byStatus.find((r) => r.status === status)?._count._all ?? 0;
    const total30 = byStatus.reduce((s, r) => s + r._count._all, 0);

    return ok({
      last30d: {
        total: total30,
        // Left the clinic; Telegram reports no delivery, so SENT is the end.
        sent: countOf("SENT") + countOf("DELIVERED") + countOf("READ"),
        failed: countOf("FAILED"),
        queued: countOf("QUEUED") + countOf("SENDING"),
        inApp: inApp30,
      },
      today: {
        sent: todaySent,
        inApp: todayInApp,
        failed: todayFailed,
        queued: todayQueued,
      },
      activeTemplates,
      topTemplates,
    });
  },
);
