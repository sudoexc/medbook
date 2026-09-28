/**
 * PATCH/DELETE /api/crm/knowledge/diagnoses/[id] — correct or remove a
 * diagnosis wording the clinic learned from practice (audit CT-05).
 *
 * PATCH `{ code }` sets or clears the ICD code of the wording. DELETE removes
 * the row, so it leaves every doctor's picker at once. It is a real delete:
 * notes keep their own copy of the wording and code, nothing points at the
 * row. If a doctor signs that exact wording again the catalog learns it
 * again, which is the point of a learning catalog; a typo nobody repeats is
 * gone for good.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { forbidden, notFound, ok } from "@/server/http";
import { UpdateClinicDiagnosisSchema } from "@/server/schemas/knowledge";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateClinicDiagnosisSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);

    const existing = await prisma.clinicDiagnosis.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, code: true, nameRu: true },
    });
    if (!existing) return notFound();

    const row = await prisma.clinicDiagnosis.update({
      where: { id },
      data: { code: body.code },
      select: { id: true, code: true, nameRu: true, usageCount: true },
    });
    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_DIAGNOSIS_UPDATED,
      entityType: "ClinicDiagnosis",
      entityId: id,
      meta: { nameRu: existing.nameRu, code: row.code, previousCode: existing.code },
    });
    return ok({ row });
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);

    const existing = await prisma.clinicDiagnosis.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, code: true, nameRu: true, usageCount: true },
    });
    if (!existing) return notFound();

    await prisma.clinicDiagnosis.delete({ where: { id } });
    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_DIAGNOSIS_DELETED,
      entityType: "ClinicDiagnosis",
      entityId: id,
      meta: {
        nameRu: existing.nameRu,
        code: existing.code,
        usageCount: existing.usageCount,
      },
    });
    return ok({ removed: true });
  },
);
