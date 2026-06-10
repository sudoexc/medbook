/**
 * PATCH/DELETE /api/crm/knowledge/drugs/[id] — edit a CLINIC-LOCAL drug (Ф4).
 *
 * Only rows with `clinicId === ctx.clinicId` are reachable — a global row id
 * 404s here by design (globals are patched via the overlay route). DELETE is
 * a soft-deactivate (`active=false`): historical VisitPrescription rows keep
 * referencing the drug; PATCH `{active: true}` restores it.
 */
import { Prisma } from "@/generated/prisma/client";
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { err, forbidden, notFound, ok } from "@/server/http";
import { UpdateClinicDrugSchema } from "@/server/schemas/knowledge";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateClinicDrugSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);

    const existing = await prisma.drug.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true },
    });
    if (!existing) return notFound();

    const data: Record<string, unknown> = {};
    if (body.inn !== undefined) data.inn = body.inn.trim();
    if (body.nameRu !== undefined) data.nameRu = body.nameRu.trim();
    if (body.nameUz !== undefined) data.nameUz = body.nameUz?.trim() || null;
    if (body.category !== undefined) data.category = body.category;
    if (body.atcCode !== undefined) data.atcCode = body.atcCode?.trim() || null;
    if (body.forms !== undefined) {
      data.forms = body.forms as Prisma.InputJsonValue;
    }
    if (body.indications !== undefined) {
      data.indications = body.indications.map((p) => p.toUpperCase());
    }
    if (body.contraindications !== undefined) {
      data.contraindications = body.contraindications;
    }
    if (body.sideEffects !== undefined) data.sideEffects = body.sideEffects;
    if (body.defaultDosing !== undefined) {
      data.defaultDosing = body.defaultDosing
        ? (body.defaultDosing as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    if (body.rxOnly !== undefined) data.rxOnly = body.rxOnly;
    if (body.active !== undefined) data.active = body.active;

    if (Object.keys(data).length === 0) return err("EmptyPatch", 400);

    try {
      const row = await prisma.drug.update({ where: { id }, data });
      await audit(request, {
        action: AUDIT_ACTION.KNOWLEDGE_DRUG_UPDATED,
        entityType: "Drug",
        entityId: row.id,
        meta: { fields: Object.keys(data) },
      });
      return ok({ row });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return err("DrugAlreadyExists", 409, { reason: "inn_taken" });
      }
      throw e;
    }
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);

    const existing = await prisma.drug.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, nameRu: true },
    });
    if (!existing) return notFound();

    await prisma.drug.update({ where: { id }, data: { active: false } });
    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_DRUG_DELETED,
      entityType: "Drug",
      entityId: id,
      meta: { nameRu: existing.nameRu },
    });
    return ok({ removed: true });
  },
);
