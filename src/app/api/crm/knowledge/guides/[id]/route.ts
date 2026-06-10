/**
 * PATCH/DELETE /api/crm/knowledge/guides/[id] — edit a CLINIC-LOCAL guide
 * (Ф4). Global guides 404 here; they are patched via the GUIDE overlay.
 * DELETE soft-deactivates.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { err, forbidden, notFound, ok } from "@/server/http";
import { UpdateClinicGuideSchema } from "@/server/schemas/knowledge";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const TEXT_BLOCKS = [
  "whatToDoRu",
  "whatToDoUz",
  "careRu",
  "careUz",
  "lifestyleRu",
  "lifestyleUz",
  "redFlagsRu",
  "redFlagsUz",
] as const;

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateClinicGuideSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);

    const existing = await prisma.diagnosisGuide.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true },
    });
    if (!existing) return notFound();

    const data: Record<string, unknown> = {};
    if (body.matchPrefix !== undefined) {
      data.matchPrefix = body.matchPrefix.trim().toUpperCase();
    }
    if (body.titleRu !== undefined) data.titleRu = body.titleRu.trim();
    if (body.titleUz !== undefined) data.titleUz = body.titleUz?.trim() || null;
    for (const key of TEXT_BLOCKS) {
      const v = body[key];
      if (v !== undefined) data[key] = v?.trim() || null;
    }
    if (body.adviceChips !== undefined) data.adviceChips = body.adviceChips;
    if (body.defaultFollowUpDays !== undefined) {
      data.defaultFollowUpDays = body.defaultFollowUpDays;
    }
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.active !== undefined) data.active = body.active;

    if (Object.keys(data).length === 0) return err("EmptyPatch", 400);

    const row = await prisma.diagnosisGuide.update({ where: { id }, data });
    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_GUIDE_UPDATED,
      entityType: "DiagnosisGuide",
      entityId: row.id,
      meta: { fields: Object.keys(data) },
    });
    return ok({ row });
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);

    const existing = await prisma.diagnosisGuide.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, code: true, titleRu: true },
    });
    if (!existing) return notFound();

    await prisma.diagnosisGuide.update({
      where: { id },
      data: { active: false },
    });
    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_GUIDE_DELETED,
      entityType: "DiagnosisGuide",
      entityId: id,
      meta: { code: existing.code, titleRu: existing.titleRu },
    });
    return ok({ removed: true });
  },
);
