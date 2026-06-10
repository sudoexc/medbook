/**
 * POST /api/crm/knowledge/guides — add a clinic-local diagnosis guide (Ф4).
 *
 * Clinic guides shadow globals at equal prefix specificity (see
 * /api/crm/guides ranking) — so adding a guide for "G43" effectively
 * replaces the global migraine guide for this clinic without touching it.
 * `code` is server-generated: unique per clinic via @@unique([clinicId, code]).
 */
import { randomUUID } from "node:crypto";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { forbidden, ok } from "@/server/http";
import { CreateClinicGuideSchema } from "@/server/schemas/knowledge";

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateClinicGuideSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();

    const matchPrefix = body.matchPrefix.trim().toUpperCase();
    const code = `${matchPrefix.toLowerCase().replace(/[^a-z0-9]+/g, "")}-${randomUUID().slice(0, 8)}`;

    const row = await prisma.diagnosisGuide.create({
      data: {
        clinicId: ctx.clinicId,
        code,
        matchPrefix,
        titleRu: body.titleRu.trim(),
        titleUz: body.titleUz?.trim() || null,
        whatToDoRu: body.whatToDoRu?.trim() || null,
        whatToDoUz: body.whatToDoUz?.trim() || null,
        careRu: body.careRu?.trim() || null,
        careUz: body.careUz?.trim() || null,
        lifestyleRu: body.lifestyleRu?.trim() || null,
        lifestyleUz: body.lifestyleUz?.trim() || null,
        redFlagsRu: body.redFlagsRu?.trim() || null,
        redFlagsUz: body.redFlagsUz?.trim() || null,
        adviceChips: body.adviceChips,
        defaultFollowUpDays: body.defaultFollowUpDays ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_GUIDE_CREATED,
      entityType: "DiagnosisGuide",
      entityId: row.id,
      meta: { code: row.code, matchPrefix: row.matchPrefix, titleRu: row.titleRu },
    });
    return ok({ row }, 201);
  },
);
