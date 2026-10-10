/**
 * GET /api/crm/doctors/me/diagnosis-memory?code=G43.0&exclude=<noteId>
 * GET /api/crm/doctors/me/diagnosis-memory?name=Тиннитус&exclude=<noteId>
 *
 * «Обычно при <диагноз>» on the visit screen (clinic request 03.10.2026):
 * the prescriptions (drug, dose and schema) and the recommendations this
 * doctor usually gives with a diagnosis, learned from his own visits with it
 * as the main diagnosis, signed and drafts, most recent first. What counts
 * as usual lives in `buildDiagnosisMemory` (unit-tested).
 *
 * Scope and cost: the caller's own notes in the caller's clinic (the tenant
 * extension adds the clinic to every read, the doctor is the caller's row),
 * the last `days` (365), at most 200 notes, newest first. The note read
 * walks the (clinicId, doctorId, …) index and the rows of those notes come
 * by their (clinicId, visitNoteId) index, so one diagnosis pick costs two
 * indexed reads and no schema change. `exclude` leaves out the visit being
 * written, whose own rows are not history yet.
 *
 * Every drug is answered the way the drug shortlist answers it: the catalog
 * row as this clinic sees it, a brand a catalog repair moved re-pinned to
 * its row (audit CT-03), so a click on a memory chip makes the same row a
 * click in «Частые» would.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok, parseQuery } from "@/server/http";
import { loadDrugHits } from "@/server/catalog/drug-hits";
import { loadFormulary } from "@/server/catalog/formulary";
import { followMovedBrands } from "@/server/catalog/moved-brands";
import {
  buildDiagnosisMemory,
  type MemoryNote,
} from "@/server/catalog/diagnosis-memory";

import type { DrugShortlistEntry } from "../drug-shortlist/route";

const QuerySchema = z
  .object({
    code: z.string().trim().max(20).optional(),
    name: z.string().trim().max(500).optional(),
    exclude: z.string().trim().max(64).optional(),
    days: z.coerce.number().int().min(7).max(730).default(365),
  })
  .refine((q) => !!q.code || !!q.name, { message: "code or name required" });

/** The most recent visits read per diagnosis. */
const NOTE_LIMIT = 200;

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const { code, name, exclude, days } = parsed.value;

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

    const [notes, formulary] = await Promise.all([
      prisma.visitNote.findMany({
        where: {
          doctorId: doctor.id,
          createdAt: { gte: since },
          ...(exclude ? { id: { not: exclude } } : {}),
          // A coded diagnosis is its code, whatever words it was written
          // with; one in the doctor's own words is those words.
          ...(code
            ? { diagnosisCode: { equals: code, mode: "insensitive" as const } }
            : {
                diagnosisCode: null,
                diagnosisName: { equals: name!, mode: "insensitive" as const },
              }),
        },
        select: {
          id: true,
          createdAt: true,
          prescriptions: true,
          advice: true,
          visitPrescriptions: {
            select: {
              drugId: true,
              displayName: true,
              dose: true,
              form: true,
              strength: true,
              timesOfDay: true,
              mealRelation: true,
              durationDays: true,
              ongoing: true,
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
        take: NOTE_LIMIT,
      }),
      loadFormulary(),
    ]);

    const uses = await followMovedBrands(
      notes.flatMap((n) =>
        n.visitPrescriptions.map((r) => ({ ...r, at: n.createdAt, noteId: n.id })),
      ),
      ctx.clinicId,
      formulary,
    );
    const usesByNote = new Map<string, typeof uses>();
    for (const u of uses) {
      const list = usesByNote.get(u.noteId) ?? [];
      list.push(u);
      usesByNote.set(u.noteId, list);
    }

    const memory = buildDiagnosisMemory({
      notes: notes.map(
        (n): MemoryNote => ({
          id: n.id,
          at: n.createdAt,
          structured: usesByNote.get(n.id) ?? [],
          freeText: n.prescriptions,
          advice: n.advice,
        }),
      ),
    });

    const hits = await loadDrugHits(
      memory.prescriptions
        .map((p) => p.drugId)
        .filter((id): id is string => !!id),
      ctx.clinicId,
      formulary,
    );
    const formularyByDrug = new Map(formulary.map((f) => [f.drugId, f]));
    const prescriptions: DrugShortlistEntry[] = memory.prescriptions.map((p) => ({
      ...p,
      strengths: (p.drugId && formularyByDrug.get(p.drugId)?.strengths) || [],
      // A drug hidden or retired since comes back as his own text line: the
      // constructor adds it like any line without a catalog row.
      drug: p.drugId ? (hits.get(p.drugId) ?? null) : null,
    }));

    return ok({
      visits: memory.visits,
      prescriptions,
      advice: memory.advice,
      windowDays: days,
    });
  },
);
