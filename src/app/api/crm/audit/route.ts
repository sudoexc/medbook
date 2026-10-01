/**
 * /api/crm/audit — query the audit log.
 * See docs/TZ.md §6.9.
 *
 * AuditLog is NOT in the tenant-scope allowlist (see tenant-allowlist.ts),
 * so we explicitly filter by clinicId here for non-SUPER_ADMIN users.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { tashkentDayRange } from "@/lib/tashkent-time";
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
    // «Журнал по пациенту» (audit G1-10): rows about the card itself, and
    // rows of other entities (an allergy, a visit, a DSAR job) whose meta
    // carries the patient's id.
    if (q.patientId) {
      where.OR = [
        { entityId: q.patientId },
        { meta: { path: ["patientId"], equals: q.patientId } },
      ];
    }
    // The filter's dates are Tashkent days, the last one included whole.
    const createdAt = tashkentDayRange(q.from, q.to);
    if (createdAt) where.createdAt = createdAt;

    const take = q.limit + 1;
    const rows = await prisma.auditLog.findMany({
      where,
      // `id` breaks ties (rows of one request share a timestamp), so the
      // cursor lands in the same place on the next page.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      rows.pop();
      // The cursor is the LAST row sent: `skip: 1` steps over it. Pointing
      // it at the popped look-ahead row skipped that row on every page.
      nextCursor = rows[rows.length - 1]?.id ?? null;
    }
    return ok({ rows, nextCursor });
  }
);
