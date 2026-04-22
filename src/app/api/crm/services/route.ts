/**
 * /api/crm/services — list + create. See docs/TZ.md §6.*.settings.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, parseQuery } from "@/server/http";
import { CreateServiceSchema, QueryServiceSchema } from "@/server/schemas/service";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryServiceSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (typeof q.isActive === "boolean") where.isActive = q.isActive;
    if (q.category) where.category = q.category;
    if (q.q) {
      where.OR = [
        { code: { contains: q.q, mode: "insensitive" } },
        { nameRu: { contains: q.q, mode: "insensitive" } },
        { nameUz: { contains: q.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.service.findMany({
      where,
      orderBy: { nameRu: "asc" },
      take: q.limit + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    return ok({ rows, nextCursor });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateServiceSchema },
  async ({ request, body }) => {
    try {
      const created = await prisma.service.create({
        data: {
          code: body.code,
          nameRu: body.nameRu,
          nameUz: body.nameUz,
          category: body.category ?? null,
          durationMin: body.durationMin,
          priceBase: body.priceBase,
          isActive: body.isActive ?? true,
        } as never,
      });
      await audit(request, {
        action: "service.create",
        entityType: "Service",
        entityId: created.id,
        meta: { after: created },
      });
      return ok(created, 201);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Unique")) {
        return err("conflict", 409, { reason: "code_taken" });
      }
      throw e;
    }
  }
);
