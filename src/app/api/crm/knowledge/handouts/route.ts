/**
 * POST /api/crm/knowledge/handouts — add a clinic-local handout template
 * (Ф4). `code` is server-generated (`HandoutTemplate.code` is globally
 * unique); the clinic identifies rows by title, not code.
 */
import { randomUUID } from "node:crypto";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { forbidden, ok } from "@/server/http";
import { CreateClinicHandoutSchema } from "@/server/schemas/knowledge";

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateClinicHandoutSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();

    const row = await prisma.handoutTemplate.create({
      data: {
        code: `c-${randomUUID()}`,
        clinicId: ctx.clinicId,
        titleRu: body.titleRu.trim(),
        titleUz: body.titleUz?.trim() || null,
        summaryRu: body.summaryRu?.trim() || null,
        bodyMd: body.bodyMd,
        bodyMdUz: body.bodyMdUz?.trim() || null,
        matchPrefixes: body.matchPrefixes.map((p) => p.toUpperCase()),
        topic: body.topic?.trim() || null,
        sortOrder: body.sortOrder ?? 0,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_HANDOUT_CREATED,
      entityType: "HandoutTemplate",
      entityId: row.id,
      meta: { code: row.code, titleRu: row.titleRu },
    });
    return ok({ row }, 201);
  },
);
