/**
 * GET /api/platform/audit — cross-tenant audit log view.
 *
 * AuditLog is in MODELS_WITHOUT_TENANT so under SUPER_ADMIN context Prisma
 * does not auto-scope. We filter explicitly — `clinicId?` allows narrowing
 * to one clinic, and with no filter we return all audit rows.
 */
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { createPlatformListHandler } from "@/server/platform/handler";
import { QueryPlatformAuditSchema } from "@/server/schemas/platform";

export const GET = createPlatformListHandler(async ({ request }) => {
  const parsed = parseQuery(request, QueryPlatformAuditSchema);
  if (!parsed.ok) return parsed.response;
  const q = parsed.value;

  const where: Record<string, unknown> = {};
  if (q.clinicId) where.clinicId = q.clinicId;
  if (q.entityType) where.entityType = q.entityType;
  if (q.action) where.action = { contains: q.action };
  if (q.actorId) where.actorId = q.actorId;
  if (q.from || q.to) {
    const dateFilter: Record<string, Date> = {};
    if (q.from) dateFilter.gte = q.from;
    if (q.to) dateFilter.lte = q.to;
    where.createdAt = dateFilter;
  }

  const take = q.limit + 1;
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    select: {
      id: true,
      clinicId: true,
      actorId: true,
      actorRole: true,
      actorLabel: true,
      action: true,
      entityType: true,
      entityId: true,
      meta: true,
      ip: true,
      createdAt: true,
      clinic: { select: { id: true, slug: true, nameRu: true } },
      actor: { select: { id: true, name: true, email: true } },
    },
  });

  let nextCursor: string | null = null;
  if (rows.length > q.limit) {
    const next = rows.pop();
    nextCursor = next?.id ?? null;
  }
  return ok({ rows, nextCursor });
});
