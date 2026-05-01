/**
 * /api/crm/settings/notifications/templates — list templates per clinic for the
 * settings editor (Phase 8b/c).
 *
 * GET only here. Updates go to /api/crm/settings/notifications/templates/[id].
 *
 * Per-clinic scoping is enforced by the tenant-scope Prisma extension (the
 * createApiListHandler wraps the inner handler in `runWithTenant`).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async () => {
    const rows = await prisma.notificationTemplate.findMany({
      orderBy: [{ category: "asc" }, { trigger: "asc" }, { key: "asc" }],
      select: {
        id: true,
        key: true,
        nameRu: true,
        nameUz: true,
        channel: true,
        category: true,
        trigger: true,
        triggerConfig: true,
        bodyRu: true,
        bodyUz: true,
        isActive: true,
        updatedAt: true,
      },
    });
    return ok({ rows });
  },
);
