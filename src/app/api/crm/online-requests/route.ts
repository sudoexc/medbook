/**
 * /api/crm/online-requests — the «Заявки» list: booking requests from the
 * public site. See docs/TZ.md §6.7, §7.2.
 *
 * Reads `Lead`, the table POST /api/leads writes (audit LD-01). It used to
 * read `OnlineRequest`, which nothing ever created, so the action-center
 * link and the dashboard counter pointed at a permanently empty set while
 * real requests piled up unseen.
 *
 * Order: NEW first (the work queue), then newest first. `tally` gives the
 * per-status counts for the screen's tabs regardless of the active filter.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import {
  ONLINE_REQUEST_ROLES,
  QueryOnlineRequestSchema,
} from "@/server/schemas/online-request";

export const GET = createApiListHandler(
  { roles: [...ONLINE_REQUEST_ROLES] },
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
    const [rows, grouped] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take,
        ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
        select: {
          id: true,
          name: true,
          phone: true,
          service: true,
          date: true,
          status: true,
          source: true,
          comment: true,
          createdAt: true,
          updatedAt: true,
          doctorId: true,
          doctor: { select: { id: true, nameRu: true, nameUz: true } },
          patient: { select: { id: true, fullName: true } },
          appointment: { select: { id: true, date: true, time: true } },
        },
      }),
      prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    const tally: Record<string, number> = {
      NEW: 0,
      CONTACTED: 0,
      CONVERTED: 0,
      CANCELLED: 0,
    };
    for (const g of grouped) tally[g.status] = g._count._all;

    return ok({ rows, nextCursor, tally });
  },
);
