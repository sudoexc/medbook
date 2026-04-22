/**
 * /api/crm/online-requests/[id] — get + patch (assign, comment, status).
 * See docs/TZ.md §6.7.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff } from "@/server/http";
import { UpdateOnlineRequestSchema } from "@/server/schemas/online-request";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.onlineRequest.findUnique({
      where: { id },
      include: { patient: { select: { id: true, fullName: true } } },
    });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"],
    bodySchema: UpdateOnlineRequestSchema,
  },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.onlineRequest.findUnique({ where: { id } });
    if (!before) return notFound();
    const after = await prisma.onlineRequest.update({
      where: { id },
      data: body as never,
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "online-request.update",
      entityType: "OnlineRequest",
      entityId: id,
      meta: d,
    });
    return ok(after);
  }
);
