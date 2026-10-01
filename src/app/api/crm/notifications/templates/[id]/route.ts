/**
 * /api/crm/notifications/templates/[id] — get, patch, delete.
 * See docs/TZ.md §6.4.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, ok, notFound, diff } from "@/server/http";
import {
  sanitizeTriggerConfig,
  templateChannelRefusal,
  verbatimPlaceholderLeak,
} from "@/server/notifications/rules";
import { retireSlotRivals } from "@/server/notifications/template-slot";
import { UpdateTemplateSchema } from "@/server/schemas/notification";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.notificationTemplate.findUnique({ where: { id } });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateTemplateSchema },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.notificationTemplate.findUnique({
      where: { id },
    });
    if (!before) return notFound();
    // The bot's greeting is sent verbatim: a placeholder would reach the
    // patient as «{{patient.firstName}}» (audit ST-08). Checked on the texts
    // this edit sends, or on both when it renames a template to that key.
    const nextKey = body.key ?? before.key;
    const leak = verbatimPlaceholderLeak(
      nextKey,
      body.key && body.key !== before.key
        ? [body.bodyRu ?? before.bodyRu, body.bodyUz ?? before.bodyUz]
        : [body.bodyRu, body.bodyUz],
    );
    if (leak) {
      return err("UnknownPlaceholder", 400, { unknown: leak, allowed: [] });
    }
    // No email delivery exists (audit UX-10): an EMAIL template stays off.
    const refusal = templateChannelRefusal(
      {
        channel: body.channel ?? before.channel,
        isActive: body.isActive ?? before.isActive,
      },
      before,
    );
    if (refusal) return err("ChannelNotSupported", 400, { reason: refusal });
    const data: Record<string, unknown> = { ...body };
    if (body.triggerConfig !== undefined) {
      const trigger = body.trigger ?? before.trigger;
      data.triggerConfig =
        body.triggerConfig === null
          ? null
          : sanitizeTriggerConfig(body.triggerConfig, {
              kind: trigger === "APPOINTMENT_BEFORE" ? "before" : "other",
            });
    }
    const { after, retired } = await prisma.$transaction(async (tx) => {
      const after = await tx.notificationTemplate.update({
        where: { id },
        data: data as never,
      });
      // One active template per event (TG-22): a template switched on, or
      // moved to another event, switches that event's other one off.
      const retired = await retireSlotRivals(tx, id);
      return { after, retired };
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "template.update",
      entityType: "NotificationTemplate",
      entityId: id,
      meta: { ...d, ...(retired.length > 0 ? { retiredTemplateIds: retired } : {}) },
    });
    return ok(after);
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.notificationTemplate.findUnique({
      where: { id },
    });
    if (!before) return notFound();
    const after = await prisma.notificationTemplate.update({
      where: { id },
      data: { isActive: false },
    });
    await audit(request, {
      action: "template.delete",
      entityType: "NotificationTemplate",
      entityId: id,
      meta: { before, after },
    });
    return ok({ id, deleted: true });
  }
);
