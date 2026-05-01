import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, parseQuery } from "@/server/http";
import { CreateCabinetSchema, QueryCabinetSchema } from "@/server/schemas/cabinet";
import { resolveEffectiveBranchId } from "@/server/branches/resolve-branch";

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
      include: {
        // Surface the occupant so the UI can display "Свободен / Занят: <name>"
        // and the doctor-edit form can disable cabinets bound to other doctors.
        // Doctor.cabinetId is UNIQUE so this is at most one row.
        doctor: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            isActive: true,
          },
        },
      },
    });
    return ok({
      rows: rows.map((c) => ({
        ...c,
        occupant: c.doctor
          ? {
              id: c.doctor.id,
              nameRu: c.doctor.nameRu,
              nameUz: c.doctor.nameUz,
              isActive: c.doctor.isActive,
            }
          : null,
        doctor: undefined,
      })),
    });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateCabinetSchema },
  async ({ request, body, ctx }) => {
    try {
      let branchId: string | null = null;
      try {
        branchId = await resolveEffectiveBranchId(ctx, body.branchId);
      } catch (e) {
        const reason = (e as { reason?: string }).reason ?? "branch_invalid";
        return err("BranchInvalid", 422, { reason });
      }
      const created = await prisma.cabinet.create({
        data: {
          number: body.number,
          floor: body.floor ?? null,
          nameRu: body.nameRu ?? null,
          nameUz: body.nameUz ?? null,
          equipment: body.equipment ?? [],
          isActive: body.isActive ?? true,
          branchId,
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
