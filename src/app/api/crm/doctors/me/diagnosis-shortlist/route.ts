/**
 * GET /api/crm/doctors/me/diagnosis-shortlist — the diagnoses that open when
 * the doctor taps the diagnosis field with nothing typed yet: his starred
 * codes, then what he actually writes most (drafts included — most visits
 * here are never signed), as the main diagnosis or as one of the others.
 * Everything else in the ICD catalog and the clinic's learned list stays
 * behind search.
 *
 * The visit screen's diagnosis picker (clinic request 03.10.2026: the
 * diagnosis picked with the mouse) reads two more lists from the same
 * history: `frequent`, what he writes most, starred or not (column
 * «Частые»), and `starred`, his stars in his order with their names (column
 * «Мои»). The third column, «Каталог МКБ», is /api/crm/icd10/tree.
 *
 * Everything is this doctor's, in the caller's clinic (the tenant extension
 * scopes the notes), over a bounded window: the last `days` (365), at most
 * 3000 notes. Ranking lives in `buildDiagnosisShortlist` /
 * `buildDiagnosisColumns` (unit-tested).
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok, parseQuery } from "@/server/http";
import { ICD10_ENTRIES } from "@/server/icd10/data";
import {
  buildDiagnosisColumns,
  buildDiagnosisShortlist,
  noteDiagnosisUses,
} from "@/server/catalog/shortlist";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(12),
  days: z.coerce.number().int().min(7).max(1095).default(365),
});

/** Rows of the «Частые» column. */
const FREQUENT_LIMIT = 30;

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
        select: {
          diagnosisCode: true,
          diagnosisName: true,
          additionalDiagnoses: true,
          createdAt: true,
        },
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

    const pinnedCodes = favorites.map((f) => f.entityCode);
    const uses = notes.flatMap(noteDiagnosisUses);
    const nameForCode = (code: string) =>
      staticName(code) ?? learnedNames.get(code) ?? null;
    const rows = buildDiagnosisShortlist({ pinnedCodes, uses, nameForCode, limit });
    const { frequent, starred } = buildDiagnosisColumns({
      pinnedCodes,
      uses,
      nameForCode,
      frequentLimit: FREQUENT_LIMIT,
    });

    return ok({ rows, frequent, starred, windowDays: days });
  },
);
