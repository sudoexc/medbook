/**
 * /api/crm/audit — query the audit log.
 * See docs/TZ.md §6.9.
 *
 * AuditLog is NOT in the tenant-scope allowlist (see tenant-allowlist.ts),
 * so we explicitly filter by clinicId here for non-SUPER_ADMIN users.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { QueryAuditSchema } from "@/server/schemas/audit";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryAuditSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (ctx.kind === "TENANT") where.clinicId = ctx.clinicId;
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;
    if (q.actorId) where.actorId = q.actorId;
    if (q.action) where.action = q.action;
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      };
    }

    const take = q.limit + 1;
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        actor: { select: { id: true, name: true, email: true, role: true } },
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
