import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, parseQuery } from "@/server/http";
import { CreateCabinetSchema, QueryCabinetSchema } from "@/server/schemas/cabinet";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryCabinetSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;
    const where: Record<string, unknown> = {};
    if (typeof q.isActive === "boolean") where.isActive = q.isActive;
    const rows = await prisma.cabinet.findMany({
      where,
      orderBy: { number: "asc" },
      take: q.limit,
    });
    return ok({ rows });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateCabinetSchema },
  async ({ request, body }) => {
    try {
      const created = await prisma.cabinet.create({
        data: {
          number: body.number,
          floor: body.floor ?? null,
          nameRu: body.nameRu ?? null,
          nameUz: body.nameUz ?? null,
          equipment: body.equipment ?? [],
          isActive: body.isActive ?? true,
        } as never,
      });
      await audit(request, {
        action: "cabinet.create",
        entityType: "Cabinet",
        entityId: created.id,
        meta: { after: created },
      });
      return ok(created, 201);
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Unique")) {
        return err("conflict", 409, { reason: "number_taken" });
      }
      throw e;
    }
  }
);
