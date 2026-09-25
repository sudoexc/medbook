/**
 * GET /api/crm/doctors/me/drug-shortlist — what opens when the doctor taps
 * the drug field with nothing typed yet.
 *
 *   - `mine`   — his starred drugs, then what he actually prescribes most
 *                (structured rows and free-text lines, drafts included);
 *   - `clinic` — the clinic's core list («основные препараты»), minus what
 *                is already in `mine`. It carries a doctor with no history
 *                yet, and it is the same for every doctor of the clinic.
 *
 * Everything else in the catalog stays behind search. Ranking lives in
 * `buildDrugShortlist` (unit-tested).
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok, parseQuery } from "@/server/http";
import { loadFormulary } from "@/server/catalog/formulary";
import { loadDrugHits, type DrugHit } from "@/server/catalog/drug-hits";
import { buildDrugShortlist } from "@/server/catalog/shortlist";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(12),
  days: z.coerce.number().int().min(7).max(730).default(365),
});

export type DrugShortlistEntry = {
  key: string;
  drugId: string | null;
  label: string;
  count: number;
  lastDose: string | null;
  pinned: boolean;
  /** Strengths the clinic uses for this drug (core list), else empty. */
  strengths: string[];
  drug: DrugHit | null;
};

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

    const [favorites, structured, notes, formulary] = await Promise.all([
      prisma.doctorFavorite.findMany({
        where: { userId: ctx.userId, entityType: "DRUG" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { entityCode: true },
        take: 50,
      }),
      prisma.visitPrescription.findMany({
        where: {
          visitNote: { doctorId: doctor.id, createdAt: { gte: since } },
        },
        select: {
          displayName: true,
          dose: true,
          drugId: true,
          visitNote: { select: { createdAt: true } },
        },
        orderBy: { visitNote: { createdAt: "desc" } },
        take: 3000,
      }),
      prisma.visitNote.findMany({
        where: {
          doctorId: doctor.id,
          createdAt: { gte: since },
          NOT: { prescriptions: { isEmpty: true } },
        },
        select: { prescriptions: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      loadFormulary(),
    ]);

    const items = buildDrugShortlist({
      pinnedIds: favorites.map((f) => f.entityCode),
      structured: structured.map((s) => ({
        drugId: s.drugId,
        displayName: s.displayName,
        dose: s.dose,
        at: s.visitNote.createdAt,
      })),
      freeText: notes.flatMap((n) =>
        n.prescriptions.map((line) => ({ line, at: n.createdAt })),
      ),
      limit,
    });

    const hits = await loadDrugHits(
      [
        ...items.map((i) => i.drugId).filter((id): id is string => !!id),
        ...formulary.map((f) => f.drugId),
      ],
      ctx.clinicId,
      formulary,
    );
    const formularyByDrug = new Map(formulary.map((f) => [f.drugId, f]));

    const mine: DrugShortlistEntry[] = [];
    for (const item of items) {
      const drug = item.drugId ? (hits.get(item.drugId) ?? null) : null;
      // A starred drug that is no longer visible (retired, hidden by the
      // clinic) has nothing to show — no label, no row to prescribe.
      if (item.pinned && item.count === 0 && !drug) continue;
      const f = item.drugId ? formularyByDrug.get(item.drugId) : undefined;
      mine.push({
        ...item,
        label: item.label || f?.label || drug?.nameRu || "",
        strengths: f?.strengths ?? [],
        drug,
      });
    }

    const taken = new Set(mine.map((m) => m.drugId).filter(Boolean));
    const clinic: DrugShortlistEntry[] = [];
    for (const f of formulary) {
      if (taken.has(f.drugId)) continue;
      const drug = hits.get(f.drugId);
      if (!drug) continue;
      clinic.push({
        key: f.drugId,
        drugId: f.drugId,
        label: f.label,
        count: 0,
        lastDose: null,
        pinned: false,
        strengths: f.strengths,
        drug,
      });
    }

    return ok({ mine, clinic, windowDays: days });
  },
);
