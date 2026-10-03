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
 * «Мой арсенал» (owner request 03.10.2026): `frequent` is his top 30 (the
 * column's «10 · 20 · 30» switch shows `frequentLimit` of them), and while
 * he has written no diagnosis at all it is the clinic's most common ones
 * instead (`frequentSource: "clinic"`, from the clinic's last 400 notes).
 * `starred` follows the order of his arsenal.
 *
 * Everything is this doctor's, in the caller's clinic (the tenant extension
 * scopes the notes), over a bounded window: the last `days` (365), at most
 * 3000 notes. Reads and ranking live in `loadDoctorDiagnosisLists`
 * (src/server/catalog/doctor-lists.ts), shared with the arsenal page.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok, parseQuery } from "@/server/http";
import { loadDoctorDiagnosisLists } from "@/server/catalog/doctor-lists";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(12),
  days: z.coerce.number().int().min(7).max(1095).default(365),
});

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const { limit, days } = parsed.value;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, frequentDiagnosisLimit: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    const lists = await loadDoctorDiagnosisLists({
      doctor: { ...doctor, userId: ctx.userId },
      days,
      limit,
    });

    return ok({
      rows: lists.rows,
      frequent: lists.frequent,
      frequentSource: lists.frequentSource,
      starred: lists.starred,
      frequentLimit: lists.frequentLimit,
      windowDays: lists.windowDays,
    });
  },
);
