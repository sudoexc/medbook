/**
 * PATCH/DELETE /api/crm/knowledge/handouts/[id] — edit a CLINIC-LOCAL
 * handout template (Ф4). Global templates 404 here; they are patched via
 * the HANDOUT overlay. DELETE soft-deactivates.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { err, forbidden, notFound, ok } from "@/server/http";
import { UpdateClinicHandoutSchema } from "@/server/schemas/knowledge";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateClinicHandoutSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);

    const existing = await prisma.handoutTemplate.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true },
    });
    if (!existing) return notFound();

    const data: Record<string, unknown> = {};
    if (body.titleRu !== undefined) data.titleRu = body.titleRu.trim();
    if (body.titleUz !== undefined) data.titleUz = body.titleUz?.trim() || null;
    if (body.summaryRu !== undefined) {
      data.summaryRu = body.summaryRu?.trim() || null;
    }
    if (body.bodyMd !== undefined) data.bodyMd = body.bodyMd;
    if (body.bodyMdUz !== undefined) {
      data.bodyMdUz = body.bodyMdUz?.trim() || null;
    }
    if (body.matchPrefixes !== undefined) {
      data.matchPrefixes = body.matchPrefixes.map((p) => p.toUpperCase());
    }
    if (body.topic !== undefined) data.topic = body.topic?.trim() || null;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.active !== undefined) data.active = body.active;

    if (Object.keys(data).length === 0) return err("EmptyPatch", 400);

    const row = await prisma.handoutTemplate.update({ where: { id }, data });
    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_HANDOUT_UPDATED,
      entityType: "HandoutTemplate",
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

    const existing = await prisma.handoutTemplate.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, code: true, titleRu: true },
    });
    if (!existing) return notFound();

    await prisma.handoutTemplate.update({
      where: { id },
      data: { active: false },
    });
    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_HANDOUT_DELETED,
      entityType: "HandoutTemplate",
      entityId: id,
      meta: { code: existing.code, titleRu: existing.titleRu },
    });
    return ok({ removed: true });
  },
);
