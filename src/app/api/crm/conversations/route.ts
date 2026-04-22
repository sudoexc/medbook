/**
 * /api/crm/conversations — list threads for inbox.
 * See docs/TZ.md §6.4 inbox.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { QueryConversationSchema } from "@/server/schemas/conversation";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryConversationSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.channel) where.channel = q.channel;
    if (q.status) where.status = q.status;
    if (q.mode) where.mode = q.mode;
    if (q.assignedToId) where.assignedToId = q.assignedToId;
    if (q.unread) where.unreadCount = { gt: 0 };
    if (q.q) {
      where.OR = [
        { lastMessageText: { contains: q.q, mode: "insensitive" } },
        { patient: { fullName: { contains: q.q, mode: "insensitive" } } },
        { patient: { phone: { contains: q.q } } },
      ];
    }

    const take = q.limit + 1;
    const rows = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        patient: { select: { id: true, fullName: true, phone: true, photoUrl: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    return ok({ rows, nextCursor });
  }
);
