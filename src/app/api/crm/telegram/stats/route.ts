/**
 * /api/crm/telegram/stats — overview counters for the Telegram inbox header
 * (TZ-telegram-section.md Layer 1).
 *
 * All counts are tenant-scoped (clinicId injected by the Prisma extension) and
 * restricted to non-deleted patients linked to Telegram.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST"] },
  async () => {
    const linked = { deletedAt: null, telegramId: { not: null } } as const;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalInTelegram, reachable, blocked, optedOut, newLast7d] =
      await Promise.all([
        prisma.patient.count({ where: linked }),
        prisma.patient.count({
          where: { ...linked, marketingOptOut: false, tgBlockedAt: null },
        }),
        prisma.patient.count({
          where: { ...linked, tgBlockedAt: { not: null } },
        }),
        prisma.patient.count({
          where: { ...linked, marketingOptOut: true },
        }),
        prisma.patient.count({
          where: { ...linked, telegramLinkedAt: { gte: sevenDaysAgo } },
        }),
      ]);

    return ok({ totalInTelegram, reachable, blocked, optedOut, newLast7d });
  },
);
