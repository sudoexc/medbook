/**
 * /api/crm/online-requests — list incoming leads.
 * See docs/TZ.md §6.7.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { QueryOnlineRequestSchema } from "@/server/schemas/online-request";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryOnlineRequestSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.source) where.source = q.source;
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      };
    }
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: "insensitive" } },
        { phone: { contains: q.q } },
        { comment: { contains: q.q, mode: "insensitive" } },
      ];
    }

    const take = q.limit + 1;
    const rows = await prisma.onlineRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        patient: { select: { id: true, fullName: true } },
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
