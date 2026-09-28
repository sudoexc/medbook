/**
 * GET /api/crm/knowledge/diagnoses — the diagnosis wordings this clinic
 * learned from practice (ClinicDiagnosis), for the admin to review
 * (audit CT-05).
 *
 * The catalog learns every hand-written diagnosis a doctor picks, so a typo
 * or a code-less «мигрень» used once reached every doctor's picker with no
 * way to take it back. This lists them, most used first, with how often they
 * were signed; `[id]` corrects the code or deletes a row.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { forbidden, ok, parseQuery } from "@/server/http";
import { normalizeIcdTerm } from "@/server/icd10/search";

const QuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const { q, limit } = parsed.value;

    const term = q ? normalizeIcdTerm(q) : "";
    const where = {
      clinicId: ctx.clinicId,
      ...(term
        ? {
            OR: [
              { normalized: { contains: term } },
              { code: { startsWith: term, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.clinicDiagnosis.findMany({
        where,
        select: {
          id: true,
          code: true,
          nameRu: true,
          usageCount: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ usageCount: "desc" }, { nameRu: "asc" }],
        take: limit,
      }),
      prisma.clinicDiagnosis.count({ where }),
    ]);
    return ok({ rows, total });
  },
);
