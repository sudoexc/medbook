/**
 * GET /api/platform/users — global user list. SUPER_ADMIN only.
 *
 * Supports filters: `q` (search name/email/phone), `role`, `clinicId`, `active`.
 * Cursor-pagination via `cursor=<lastId>&limit=<n>`.
 *
 * User is in MODELS_WITHOUT_TENANT so no auto-scoping.
 */
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { createPlatformListHandler } from "@/server/platform/handler";
import { QueryPlatformUsersSchema } from "@/server/schemas/platform";

export const GET = createPlatformListHandler(async ({ request }) => {
  const parsed = parseQuery(request, QueryPlatformUsersSchema);
  if (!parsed.ok) return parsed.response;
  const q = parsed.value;

  const where: Record<string, unknown> = {};
  if (q.role) where.role = q.role;
  if (q.clinicId) where.clinicId = q.clinicId;
  if (typeof q.active === "boolean") where.active = q.active;
  if (q.q) {
    where.OR = [
      { name: { contains: q.q, mode: "insensitive" } },
      { email: { contains: q.q, mode: "insensitive" } },
      { phone: { contains: q.q, mode: "insensitive" } },
    ];
  }

  const take = q.limit + 1;
  const rows = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      phone: true,
      active: true,
      clinicId: true,
      createdAt: true,
      updatedAt: true,
      clinic: {
        select: { id: true, slug: true, nameRu: true },
      },
    },
  });
  let nextCursor: string | null = null;
  if (rows.length > q.limit) {
    const next = rows.pop();
    nextCursor = next?.id ?? null;
  }
  return ok({ rows, nextCursor });
});
