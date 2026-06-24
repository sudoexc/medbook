/**
 * /api/crm/canned-responses/[id] — patch + delete a quick-reply snippet.
 * ADMIN only. See docs/TZ-telegram-section.md Layer 4.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff } from "@/server/http";
import { UpdateCannedResponseSchema } from "@/server/schemas/canned-response";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateCannedResponseSchema },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.cannedResponse.findUnique({ where: { id } });
    if (!before) return notFound();
    const after = await prisma.cannedResponse.update({
      where: { id },
      data: body as never,
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "canned.update",
      entityType: "CannedResponse",
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
    const before = await prisma.cannedResponse.findUnique({ where: { id } });
    if (!before) return notFound();
    await prisma.cannedResponse.delete({ where: { id } });
    await audit(request, {
      action: "canned.delete",
      entityType: "CannedResponse",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deleted: true });
  }
);
