/**
 * /api/crm/notifications/templates — list + create notification templates.
 * See docs/TZ.md §6.4 reminders.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, parseQuery } from "@/server/http";
import {
  CreateTemplateSchema,
  QueryTemplateSchema,
} from "@/server/schemas/notification";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryTemplateSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.channel) where.channel = q.channel;
    if (q.category) where.category = q.category;
    if (q.isActive !== undefined) where.isActive = q.isActive;
    if (q.q) {
      where.OR = [
        { nameRu: { contains: q.q, mode: "insensitive" } },
        { nameUz: { contains: q.q, mode: "insensitive" } },
        { key: { contains: q.q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.notificationTemplate.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: q.limit,
    });
    return ok({ rows });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateTemplateSchema },
  async ({ request, body, ctx }) => {
    const createdById = ctx.kind === "TENANT" ? ctx.userId : null;
    const created = await prisma.notificationTemplate.create({
      data: {
        key: body.key,
        nameRu: body.nameRu,
        nameUz: body.nameUz,
        channel: body.channel,
        category: body.category,
        bodyRu: body.bodyRu,
        bodyUz: body.bodyUz,
        buttons: body.buttons ?? null,
        variables: body.variables ?? [],
        trigger: body.trigger,
        triggerConfig: body.triggerConfig ?? null,
        isActive: body.isActive ?? true,
        createdById,
      } as never,
    });
    await audit(request, {
      action: "template.create",
      entityType: "NotificationTemplate",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created, 201);
  }
);
