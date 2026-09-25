/**
 * GET /api/crm/doctors/me/diagnosis-shortlist — the diagnoses that open when
 * the doctor taps the diagnosis field with nothing typed yet: his starred
 * codes, then what he actually writes most (drafts included — most visits
 * here are never signed). Everything else in the ICD catalog and the
 * clinic's learned list stays behind search.
 *
 * Ranking lives in `buildDiagnosisShortlist` (unit-tested).
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok, parseQuery } from "@/server/http";
import { ICD10_ENTRIES } from "@/server/icd10/data";
import { buildDiagnosisShortlist } from "@/server/catalog/shortlist";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(12),
  days: z.coerce.number().int().min(7).max(1095).default(365),
});

let icdNames: Map<string, string> | null = null;
function staticName(code: string): string | null {
  icdNames ??= new Map(ICD10_ENTRIES.map((e) => [e.code.toUpperCase(), e.nameRu]));
  return icdNames.get(code.toUpperCase()) ?? null;
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const { limit, days } = parsed.value;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }
    const since = new Date(Date.now() - days * 86_400_000);

    const [favorites, notes, learned] = await Promise.all([
      prisma.doctorFavorite.findMany({
        where: { userId: ctx.userId, entityType: "ICD10" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { entityCode: true },
        take: 50,
      }),
      prisma.visitNote.findMany({
        where: {
          doctorId: doctor.id,
          createdAt: { gte: since },
          diagnosisName: { not: null },
        },
        select: { diagnosisCode: true, diagnosisName: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 3000,
      }),
      // Starred codes the static catalog lacks live in the clinic's list.
      prisma.clinicDiagnosis.findMany({
        where: { code: { not: null } },
        select: { code: true, nameRu: true },
        take: 1000,
      }),
    ]);

    const learnedNames = new Map(
      learned
        .filter((l): l is { code: string; nameRu: string } => !!l.code)
        .map((l) => [l.code.toUpperCase(), l.nameRu]),
    );

    const rows = buildDiagnosisShortlist({
      pinnedCodes: favorites.map((f) => f.entityCode),
      uses: notes.map((n) => ({
        code: n.diagnosisCode,
        name: n.diagnosisName,
        at: n.createdAt,
      })),
      nameForCode: (code) => staticName(code) ?? learnedNames.get(code) ?? null,
      limit,
    });

    return ok({ rows, windowDays: days });
  },
);
