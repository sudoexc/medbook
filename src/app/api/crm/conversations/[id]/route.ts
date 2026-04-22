/**
 * /api/crm/conversations/[id] — get + patch (status/mode/assignee/tags).
 * See docs/TZ.md §6.4.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff } from "@/server/http";
import { UpdateConversationSchema } from "@/server/schemas/conversation";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.conversation.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, photoUrl: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"],
    bodySchema: UpdateConversationSchema,
  },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.conversation.findUnique({ where: { id } });
    if (!before) return notFound();
    const after = await prisma.conversation.update({
      where: { id },
      data: body as never,
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "conversation.update",
      entityType: "Conversation",
      entityId: id,
      meta: d,
    });
    return ok(after);
  }
);
