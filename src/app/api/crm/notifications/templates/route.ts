/**
 * /api/crm/notifications/templates — list + create notification templates.
 * See docs/TZ.md §6.4 reminders.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, ok, parseQuery } from "@/server/http";
import {
  sanitizeTriggerConfig,
  templateChannelRefusal,
  verbatimPlaceholderLeak,
} from "@/server/notifications/rules";
import { retireSlotRivals } from "@/server/notifications/template-slot";
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
    // The bot's greeting is sent verbatim (audit ST-08).
    const leak = verbatimPlaceholderLeak(body.key, [body.bodyRu, body.bodyUz]);
    if (leak) {
      return err("UnknownPlaceholder", 400, { unknown: leak, allowed: [] });
    }
    // No email delivery exists (audit UX-10): refused, not saved to fail.
    const refusal = templateChannelRefusal(
      { channel: body.channel, isActive: body.isActive ?? true },
      null,
    );
    if (refusal) return err("ChannelNotSupported", 400, { reason: refusal });
    const createdById = ctx.kind === "TENANT" ? ctx.userId : null;
    const { created, retired } = await prisma.$transaction(async (tx) => {
      const created = await tx.notificationTemplate.create({
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
          // The editor binds the template to an event (TG-25); the config is
          // sanitised like the settings editor's (offset clamp, channels).
          triggerConfig:
            body.triggerConfig == null
              ? null
              : sanitizeTriggerConfig(body.triggerConfig, {
                  kind: body.trigger === "APPOINTMENT_BEFORE" ? "before" : "other",
                }),
          isActive: body.isActive ?? true,
          createdById,
        } as never,
      });
      // One active template per event (TG-22).
      const retired = await retireSlotRivals(tx, created.id);
      return { created, retired };
    });
    await audit(request, {
      action: "template.create",
      entityType: "NotificationTemplate",
      entityId: created.id,
      meta: { after: created, ...(retired.length > 0 ? { retiredTemplateIds: retired } : {}) },
    });
    return ok(created, 201);
  }
);
