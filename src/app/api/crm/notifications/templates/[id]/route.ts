/**
 * /api/crm/notifications/templates/[id] — get, patch, delete.
 * See docs/TZ.md §6.4.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff } from "@/server/http";
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
    const after = await prisma.notificationTemplate.update({
      where: { id },
      data: body as never,
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "template.update",
      entityType: "NotificationTemplate",
      entityId: id,
      meta: d,
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
