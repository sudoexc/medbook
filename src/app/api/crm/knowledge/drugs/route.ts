/**
 * POST /api/crm/knowledge/drugs — add a clinic-local drug (Ф4).
 *
 * Global catalog rows are read-only; a clinic that wants to tweak one uses
 * the overlay (`/api/crm/clinic-catalog-overlays` with `overrides`). This
 * route creates rows with `clinicId` set, which surface in the doctor's
 * drug drawer alongside globals (`/api/crm/catalogs/drugs`).
 *
 * `Drug.inn` is globally unique by design — if the INN already exists the
 * right move is an overlay on the global row, so we return 409 with
 * `reason: "inn_taken"` and the UI points the admin at «переопределить».
 */
import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { err, forbidden, ok } from "@/server/http";
import { CreateClinicDrugSchema } from "@/server/schemas/knowledge";

function slugifyInn(inn: string): string {
  const slug = inn
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "drug";
}

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateClinicDrugSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();

    const inn = body.inn.trim();
    const base = slugifyInn(inn);
    const taken = await prisma.drug.findUnique({
      where: { id: base },
      select: { id: true },
    });
    const id = taken ? `${base}-${randomUUID().slice(0, 8)}` : base;

    try {
      const row = await prisma.drug.create({
        data: {
          id,
          inn,
          nameRu: body.nameRu.trim(),
          nameUz: body.nameUz?.trim() || null,
          category: body.category,
          atcCode: body.atcCode?.trim() || null,
          forms: body.forms as Prisma.InputJsonValue,
          indications: body.indications.map((p) => p.toUpperCase()),
          contraindications: body.contraindications,
          sideEffects: body.sideEffects,
          defaultDosing: body.defaultDosing
            ? (body.defaultDosing as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          rxOnly: body.rxOnly,
          clinicId: ctx.clinicId,
        },
      });
      await audit(request, {
        action: AUDIT_ACTION.KNOWLEDGE_DRUG_CREATED,
        entityType: "Drug",
        entityId: row.id,
        meta: { inn: row.inn, nameRu: row.nameRu, category: row.category },
      });
      return ok({ row }, 201);
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
