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
 * The visit screen's picker (clinic request 03.10.2026: prescribing with
 * the mouse only) reads four more lists from the same history:
 *
 *   - `frequent` — what he writes most, starred or not (column «Частые»);
 *   - `starred`  — his stars in his order (column «Мои»);
 *   - `core`     — the clinic's whole core list, the first group of the
 *                  «Каталог» column, each with his own dose when he has one;
 *   - `usual`    — his last dose and schema per catalog drug, so a pick from
 *                  the catalog, the search or the drawer comes back as he
 *                  writes it.
 *
 * Everything is this doctor's: his notes and their prescription rows in the
 * caller's clinic (the tenant extension scopes those reads), and his own
 * stars, over a bounded window: the last `days` (365), at most 3000 rows and
 * 1000 notes. Ranking lives in `buildDrugShortlist` / `buildDrugColumns`
 * (unit-tested). A structured use whose brand a catalog repair moved to
 * another row («МИОСПАН» from tolperisone to lidocaine +
 * tolperisone, audit CT-03) counts under the row its label names today, see
 * `followMovedBrands` (src/server/catalog/moved-brands.ts).
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok, parseQuery } from "@/server/http";
import { loadFormulary } from "@/server/catalog/formulary";
import { loadDrugHits, type DrugHit } from "@/server/catalog/drug-hits";
import { followMovedBrands } from "@/server/catalog/moved-brands";
import {
  buildDrugColumns,
  buildDrugShortlist,
  type DrugShortItem,
} from "@/server/catalog/shortlist";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(12),
  days: z.coerce.number().int().min(7).max(730).default(365),
});

/** Rows of the «Частые» column. */
const FREQUENT_LIMIT = 30;
/** Drugs whose usual dose travels to the client (light entries, no catalog data). */
const USUAL_LIMIT = 300;

export type DrugShortlistEntry = {
  key: string;
  drugId: string | null;
  label: string;
  count: number;
  lastDose: string | null;
  lastForm: string | null;
  lastStrength: string | null;
  lastTimesOfDay: string[];
  lastMealRelation: string | null;
  lastDurationDays: number | null;
  pinned: boolean;
  /** Strengths the clinic uses for this drug (core list), else empty. */
  strengths: string[];
  drug: DrugHit | null;
};

/** His last dose and schema of one drug, without its catalog data. */
export type DrugUsualEntry = Pick<
  DrugShortlistEntry,
  | "label"
  | "count"
  | "lastDose"
  | "lastForm"
  | "lastStrength"
  | "lastTimesOfDay"
  | "lastMealRelation"
  | "lastDurationDays"
>;

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
          form: true,
          strength: true,
          timesOfDay: true,
          mealRelation: true,
          durationDays: true,
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

    const uses = await followMovedBrands(
      structured.map((s) => ({
        drugId: s.drugId,
        displayName: s.displayName,
        dose: s.dose,
        form: s.form,
        strength: s.strength,
        timesOfDay: s.timesOfDay,
        mealRelation: s.mealRelation,
        durationDays: s.durationDays,
        at: s.visitNote.createdAt,
      })),
      ctx.clinicId,
      formulary,
    );

    const pinnedIds = favorites.map((f) => f.entityCode);
    const freeText = notes.flatMap((n) =>
      n.prescriptions.map((line) => ({ line, at: n.createdAt })),
    );
    const items = buildDrugShortlist({
      pinnedIds,
      structured: uses,
      freeText,
      limit,
    });
    const columns = buildDrugColumns({
      pinnedIds,
      structured: uses,
      freeText,
      frequentLimit: FREQUENT_LIMIT,
      usualLimit: USUAL_LIMIT,
    });

    const idsOf = (list: { drugId: string | null }[]) =>
      list.map((i) => i.drugId).filter((id): id is string => !!id);
    // Stars first: `loadDrugHits` keeps the first 200 ids, and a star with
    // no catalog row is dropped from «Мои».
    const hits = await loadDrugHits(
      [
        ...idsOf(columns.starred),
        ...idsOf(columns.frequent),
        ...idsOf(items),
        ...formulary.map((f) => f.drugId),
      ],
      ctx.clinicId,
      formulary,
    );
    const formularyByDrug = new Map(formulary.map((f) => [f.drugId, f]));
    const entryOf = (item: DrugShortItem): DrugShortlistEntry | null => {
      const drug = item.drugId ? (hits.get(item.drugId) ?? null) : null;
      // A starred drug that is no longer visible (retired, hidden by the
      // clinic) has nothing to show — no label, no row to prescribe.
      if (item.pinned && item.count === 0 && !drug) return null;
      const f = item.drugId ? formularyByDrug.get(item.drugId) : undefined;
      return {
        ...item,
        label: item.label || f?.label || drug?.nameRu || "",
        strengths: f?.strengths ?? [],
        drug,
      };
    };

    const present = (e: DrugShortlistEntry | null): e is DrugShortlistEntry =>
      e !== null;
    const mine = items.map(entryOf).filter(present);
    const frequent = columns.frequent.map(entryOf).filter(present);
    const starred = columns.starred.map(entryOf).filter(present);

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
        lastForm: null,
        lastStrength: null,
        lastTimesOfDay: [],
        lastMealRelation: null,
        lastDurationDays: null,
        pinned: false,
        strengths: f.strengths,
        drug,
      });
    }

    // The whole core list, his own dose and wording on what he has written:
    // the clinic's usual strength and name are a fallback, not a
    // replacement for his.
    const pinnedSet = new Set(pinnedIds);
    const core: DrugShortlistEntry[] = [];
    for (const f of formulary) {
      const drug = hits.get(f.drugId);
      if (!drug) continue;
      const used = columns.usual.get(f.drugId);
      core.push({
        key: f.drugId,
        drugId: f.drugId,
        label: used?.label || f.label,
        count: used?.count ?? 0,
        lastDose: used?.lastDose ?? null,
        lastForm: used?.lastForm ?? null,
        lastStrength: used?.lastStrength ?? null,
        lastTimesOfDay: used?.lastTimesOfDay ?? [],
        lastMealRelation: used?.lastMealRelation ?? null,
        lastDurationDays: used?.lastDurationDays ?? null,
        pinned: pinnedSet.has(f.drugId),
        strengths: f.strengths,
        drug,
      });
    }

    const usual: Record<string, DrugUsualEntry> = {};
    for (const [drugId, u] of columns.usual) {
      usual[drugId] = {
        label: u.label,
        count: u.count,
        lastDose: u.lastDose,
        lastForm: u.lastForm,
        lastStrength: u.lastStrength,
        lastTimesOfDay: u.lastTimesOfDay,
        lastMealRelation: u.lastMealRelation,
        lastDurationDays: u.lastDurationDays,
      };
    }

    return ok({ mine, clinic, frequent, starred, core, usual, windowDays: days });
  },
);
