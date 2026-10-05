/**
 * One doctor's drug and diagnosis lists, read from the database: «Частые»
 * (his top 30), «Мои» (his arsenal, in his order, with his schemas), the
 * clinic's core list ordered by clinic-wide use, and his usual dose per
 * drug.
 *
 * Shared by the visit screen's shortlist routes (/api/crm/doctors/me/…,
 * the doctor himself) and the arsenal API (/api/crm/doctor-arsenal, the
 * doctor or the clinic's ADMIN preparing it for him), so «Частые» on the
 * visit and «Ваши частые» on the arsenal page can never count differently.
 *
 * Bounded and indexed: his last `days` (365) of notes, at most 3000 rows and
 * 1000 notes (VisitNote(clinicId, doctorId, createdAt)); the clinic's last
 * 400 notes for clinic-wide use and the no-history fallback
 * (VisitNote(clinicId, createdAt)); 400 distinct text lines sent to the
 * catalog matcher. Every read runs in the caller's tenant context: notes,
 * rows and the core list are scoped to the clinic by the tenant extension;
 * DoctorFavorite is keyed by the doctor's own login.
 *
 * Ranking is pure and unit-tested (shortlist.ts, src/lib/arsenal.ts).
 */
import {
  ARSENAL_PINS_READ,
  normalizeFrequentLimit,
  orderArsenal,
  parseDrugArsenalSchema,
  rankCoreByUse,
  type DrugArsenalSchema,
  type FrequentLimit,
} from "@/lib/arsenal";
import { prisma } from "@/lib/prisma";
import { loadDrugHits, type DrugHit } from "@/server/catalog/drug-hits";
import { loadFormulary, type FormularyEntry } from "@/server/catalog/formulary";
import { followMovedBrands } from "@/server/catalog/moved-brands";
import {
  buildDiagnosisColumns,
  buildDiagnosisShortlist,
  buildDrugColumns,
  buildDrugShortlist,
  noteDiagnosisUses,
  type DiagnosisShortItem,
  type DrugShortItem,
  type FreeTextDrugUse,
} from "@/server/catalog/shortlist";
import {
  buildDrugTextIndex,
  matchDrugLine,
  type DrugTextIndex,
  type TextMatchDrug,
} from "@/server/cds/drug-text-match";
import { ICD10_ENTRIES } from "@/server/icd10/data";
import { resolveLineDrugIds } from "@/server/visit-notes/legacy-line-drugs";

/** Rows of a «Частые» column the server sends; the client shows 10, 20 or 30. */
export const FREQUENT_TOP = 30;
/** Drugs whose usual dose travels to the client (light entries, no catalog data). */
const USUAL_LIMIT = 300;
/** Distinct text lines handed to the catalog matcher, newest first. */
const LINE_MATCH_LIMIT = 400;
/** The clinic's newest notes read for clinic-wide use and the fallback. */
export const CLINIC_NOTES_LIMIT = 400;

const DAY_MS = 86_400_000;

export type DrugShortlistEntry = DrugShortItem & {
  /** Strengths the clinic uses for this drug (core list), else empty. */
  strengths: string[];
  drug: DrugHit | null;
  /**
   * «Мои» only: the schema he set for this drug on the arsenal page, which
   * a click applies instead of his last dose. Null: none set.
   */
  arsenalSchema?: DrugArsenalSchema | null;
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

/** One pin of the drug arsenal, for the arsenal page. */
export type ArsenalDrugPin = {
  code: string;
  schema: DrugArsenalSchema | null;
  /** Null: the drug is no longer visible (retired, hidden by the clinic). */
  entry: DrugShortlistEntry | null;
};

export type DrugLists = {
  /** Stars, then his most written: the corrections-era shortlist. */
  mine: DrugShortlistEntry[];
  /** The clinic's core list minus `mine`. */
  clinic: DrugShortlistEntry[];
  /** «Частые»: his top 30, starred or not, text lines counted for their drug. */
  frequent: DrugShortlistEntry[];
  /** «Мои»: his arsenal in his order, each with its schema. */
  starred: DrugShortlistEntry[];
  /** The clinic's whole core list in the clinic's order, with his dose where he has one. */
  core: DrugShortlistEntry[];
  /** The core list's drug ids in clinic-wide use order (fills a short «Частые»). */
  coreRank: string[];
  usual: Record<string, DrugUsualEntry>;
  frequentLimit: FrequentLimit;
  windowDays: number;
  /** Arsenal page: every pin in order, unavailable ones included (so he can remove them). */
  arsenal: ArsenalDrugPin[];
  /** Arsenal page: his top 30 as catalog drugs, the source of «В арсенал». */
  topCatalog: DrugShortlistEntry[];
};

export type DoctorForLists = {
  id: string;
  /** His login: the pins are his user's. Null when the card has none. */
  userId: string | null;
  frequentDrugLimit?: number | null;
  frequentDiagnosisLimit?: number | null;
};

/**
 * The core list as a text-match index: each drug under its catalog names
 * and the clinic's own («Летирам», «Анаприлин», which loadDrugHits adds as
 * brands), for lines written in the clinic's vocabulary.
 */
function coreTextIndex(
  formulary: readonly FormularyEntry[],
  hits: ReadonlyMap<string, DrugHit>,
): DrugTextIndex<TextMatchDrug> | null {
  const drugs = formulary
    .map((f) => hits.get(f.drugId))
    .filter((h): h is DrugHit => !!h)
    .map((h) => ({
      id: h.id,
      inn: h.inn,
      nameRu: h.nameRu,
      atcCode: h.atcCode,
      brands: h.brands.map((b) => ({ name: b.name })),
    }));
  return drugs.length > 0 ? buildDrugTextIndex(drugs) : null;
}

/**
 * How often each core drug is written across the clinic: its structured
 * rows over the window, plus the text lines of the clinic's newest notes
 * that the core list's own names place on it.
 */
async function clinicCoreUse(
  formulary: readonly FormularyEntry[],
  index: DrugTextIndex<TextMatchDrug> | null,
  since: Date,
): Promise<Map<string, number>> {
  const ids = formulary.map((f) => f.drugId);
  const uses = new Map<string, number>();
  if (ids.length === 0) return uses;
  const [grouped, notes] = await Promise.all([
    prisma.visitPrescription.groupBy({
      by: ["drugId"],
      where: { drugId: { in: ids }, visitNote: { createdAt: { gte: since } } },
      _count: { _all: true },
    }),
    prisma.visitNote.findMany({
      where: { createdAt: { gte: since }, NOT: { prescriptions: { isEmpty: true } } },
      select: { prescriptions: true },
      orderBy: { createdAt: "desc" },
      take: CLINIC_NOTES_LIMIT,
    }),
  ]);
  for (const g of grouped) {
    if (g.drugId) uses.set(g.drugId, (uses.get(g.drugId) ?? 0) + g._count._all);
  }
  if (!index) return uses;
  for (const n of notes) {
    for (const line of n.prescriptions) {
      const id = matchDrugLine(index, line)?.drug.id;
      if (id) uses.set(id, (uses.get(id) ?? 0) + 1);
    }
  }
  return uses;
}

/**
 * The catalog drug each of his text lines names, newest lines first: the
 * catalog matcher of the print and the drug check (resolveLineDrugIds),
 * then the core list under the clinic's own names for a line it cannot
 * place. A matcher failure only loses the matching: the lines then count
 * as text, exactly as before, and the lists still load.
 */
async function matchLines(
  lines: readonly { line: string; at: Date }[],
  clinicId: string,
  core: DrugTextIndex<TextMatchDrug> | null,
): Promise<FreeTextDrugUse[]> {
  const distinct = [
    ...new Set(lines.map((l) => l.line.trim()).filter((l) => l.length >= 2)),
  ].slice(0, LINE_MATCH_LIMIT);
  if (distinct.length === 0) return lines.map((l) => ({ ...l, drugId: null }));
  let ids: (string | null)[] = [];
  try {
    ids = await resolveLineDrugIds(distinct, { clinicId });
  } catch (e) {
    console.warn("[doctor-lists] line matching failed", (e as Error)?.message);
  }
  const byLine = new Map(
    distinct.map((l, i) => [
      l,
      ids[i] ?? (core ? (matchDrugLine(core, l)?.drug.id ?? null) : null),
    ]),
  );
  return lines.map((l) => ({ ...l, drugId: byLine.get(l.line.trim()) ?? null }));
}

export async function loadDoctorDrugLists(args: {
  doctor: DoctorForLists;
  clinicId: string;
  days: number;
  /** Length of the corrections-era `mine` list. */
  limit: number;
}): Promise<DrugLists> {
  const { doctor, clinicId, days, limit } = args;
  const since = new Date(Date.now() - days * DAY_MS);

  const [favorites, structured, notes, formulary] = await Promise.all([
    doctor.userId
      ? prisma.doctorFavorite.findMany({
          where: { userId: doctor.userId, entityType: "DRUG" },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { entityCode: true, schema: true, sortOrder: true, createdAt: true },
          take: ARSENAL_PINS_READ,
        })
      : Promise.resolve([]),
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

  // The core list first: its clinic names place his text lines too, and it
  // ranks the core list by clinic-wide use below.
  const coreHits = await loadDrugHits(
    formulary.map((f) => f.drugId),
    clinicId,
    formulary,
  );
  const coreIndex = coreTextIndex(formulary, coreHits);

  const [uses, freeText] = await Promise.all([
    followMovedBrands(
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
      clinicId,
      formulary,
    ),
    matchLines(
      notes.flatMap((n) => n.prescriptions.map((line) => ({ line, at: n.createdAt }))),
      clinicId,
      coreIndex,
    ),
  ]);

  const pins = orderArsenal(favorites);
  const pinnedIds = pins.map((f) => f.entityCode);
  const schemas = new Map(pins.map((f) => [f.entityCode, parseDrugArsenalSchema(f.schema)]));

  const items = buildDrugShortlist({ pinnedIds, structured: uses, freeText, limit });
  const columns = buildDrugColumns({
    pinnedIds,
    structured: uses,
    freeText,
    frequentLimit: FREQUENT_TOP,
    usualLimit: USUAL_LIMIT,
  });

  const idsOf = (list: { drugId: string | null }[]) =>
    list.map((i) => i.drugId).filter((id): id is string => !!id);
  // Stars first: `loadDrugHits` keeps the first 200 ids, and a star with
  // no catalog row is dropped from «Мои». The core list is loaded already.
  const more = [
    ...idsOf(columns.starred),
    ...idsOf(columns.frequent),
    ...idsOf(items),
  ].filter((id) => !coreHits.has(id));
  const hits = new Map(coreHits);
  for (const [id, h] of await loadDrugHits(more, clinicId, formulary)) hits.set(id, h);
  const formularyByDrug = new Map(formulary.map((f) => [f.drugId, f]));

  const entryOf = (item: DrugShortItem): DrugShortlistEntry | null => {
    const hit = item.drugId ? (hits.get(item.drugId) ?? null) : null;
    // A starred drug that is no longer visible (retired, hidden by the
    // clinic) has nothing to show — no label, no row to prescribe.
    if (item.pinned && item.count === 0 && !hit) return null;
    const f = item.drugId ? formularyByDrug.get(item.drugId) : undefined;
    const label = item.label || f?.label || hit?.nameRu || "";
    if (!label) return null;
    return {
      ...item,
      label,
      strengths: f?.strengths ?? [],
      // A line-only entry stays his line: one click puts it back as he
      // wrote it, dose included, and the CDS check reads the line by name.
      drug: item.lineOnly ? null : hit,
    };
  };

  /** The same item as the catalog drug it is, for the arsenal page. */
  const catalogEntryOf = (item: DrugShortItem): DrugShortlistEntry | null => {
    if (!item.drugId) return null;
    const hit = hits.get(item.drugId);
    if (!hit) return null;
    const f = formularyByDrug.get(item.drugId);
    const { lineOnly, ...rest } = item;
    return {
      ...rest,
      label: (!lineOnly && item.label) || f?.label || hit.nameRu,
      strengths: f?.strengths ?? [],
      drug: hit,
    };
  };

  const present = (e: DrugShortlistEntry | null): e is DrugShortlistEntry => e !== null;
  const mine = items.map(entryOf).filter(present);
  const frequent = columns.frequent.map(entryOf).filter(present);
  const starred = columns.starred
    .map(entryOf)
    .filter(present)
    .map((e) => ({ ...e, arsenalSchema: (e.drugId && schemas.get(e.drugId)) || null }));

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
  // the clinic's usual strength and name are a fallback, not a replacement
  // for his.
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

  let coreUse = new Map<string, number>();
  try {
    coreUse = await clinicCoreUse(formulary, coreIndex, since);
  } catch (e) {
    // Only the order is lost: the core list then keeps the clinic's own.
    console.warn("[doctor-lists] clinic core use failed", (e as Error)?.message);
  }
  const coreRank = rankCoreByUse(
    core.map((c) => c.drugId!),
    coreUse,
  );

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

  const starredById = new Map(starred.map((e) => [e.drugId, e]));
  const arsenal: ArsenalDrugPin[] = pinnedIds.map((code) => ({
    code,
    schema: schemas.get(code) ?? null,
    entry: starredById.get(code) ?? null,
  }));
  const topCatalog = columns.frequent.map(catalogEntryOf).filter(present);

  return {
    mine,
    clinic,
    frequent,
    starred,
    core,
    coreRank,
    usual,
    frequentLimit: normalizeFrequentLimit(doctor.frequentDrugLimit),
    windowDays: days,
    arsenal,
    topCatalog,
  };
}

// ───────────────────────── Diagnoses ─────────────────────────

let icdNames: Map<string, string> | null = null;
function staticIcdName(code: string): string | null {
  icdNames ??= new Map(ICD10_ENTRIES.map((e) => [e.code.toUpperCase(), e.nameRu]));
  return icdNames.get(code.toUpperCase()) ?? null;
}

const NOTE_DIAGNOSIS_SELECT = {
  diagnosisCode: true,
  diagnosisName: true,
  additionalDiagnoses: true,
  createdAt: true,
} as const;

export type DiagnosisLists = {
  /** Stars, then his most written: what the plain search field opens. */
  rows: DiagnosisShortItem[];
  /** «Частые»: his top 30, or the clinic's while he has written none. */
  frequent: DiagnosisShortItem[];
  /** Whose «Частые» these are: his, or the clinic's fallback. */
  frequentSource: "own" | "clinic";
  /** «Мои»: his arsenal codes in his order, named. */
  starred: DiagnosisShortItem[];
  frequentLimit: FrequentLimit;
  windowDays: number;
  /** Arsenal page: every pinned code in order, named when anybody can name it. */
  arsenal: { code: string; name: string | null; count: number }[];
};

export async function loadDoctorDiagnosisLists(args: {
  doctor: DoctorForLists;
  days: number;
  /** Length of the plain field's `rows`. */
  limit: number;
}): Promise<DiagnosisLists> {
  const { doctor, days, limit } = args;
  const since = new Date(Date.now() - days * DAY_MS);

  const [favorites, notes, learned] = await Promise.all([
    doctor.userId
      ? prisma.doctorFavorite.findMany({
          where: { userId: doctor.userId, entityType: "ICD10" },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { entityCode: true, sortOrder: true, createdAt: true },
          take: ARSENAL_PINS_READ,
        })
      : Promise.resolve([]),
    prisma.visitNote.findMany({
      where: {
        doctorId: doctor.id,
        createdAt: { gte: since },
        diagnosisName: { not: null },
      },
      select: NOTE_DIAGNOSIS_SELECT,
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
  const nameForCode = (code: string) =>
    staticIcdName(code) ?? learnedNames.get(code.toUpperCase()) ?? null;

  const pinnedCodes = orderArsenal(favorites).map((f) => f.entityCode);
  const uses = notes.flatMap(noteDiagnosisUses);
  const rows = buildDiagnosisShortlist({ pinnedCodes, uses, nameForCode, limit });
  const columns = buildDiagnosisColumns({
    pinnedCodes,
    uses,
    nameForCode,
    frequentLimit: FREQUENT_TOP,
  });

  let frequent = columns.frequent;
  let frequentSource: DiagnosisLists["frequentSource"] = "own";
  if (frequent.length === 0) {
    // A doctor with no diagnosis of his own yet (new, or new to the CRM)
    // starts from what the clinic writes most, so the column is never an
    // empty box on his first visit. Read only in that case.
    const clinicNotes = await prisma.visitNote.findMany({
      where: { createdAt: { gte: since }, diagnosisName: { not: null } },
      select: NOTE_DIAGNOSIS_SELECT,
      orderBy: { createdAt: "desc" },
      take: CLINIC_NOTES_LIMIT,
    });
    const clinic = buildDiagnosisColumns({
      pinnedCodes,
      uses: clinicNotes.flatMap(noteDiagnosisUses),
      nameForCode,
      frequentLimit: FREQUENT_TOP,
    }).frequent;
    if (clinic.length > 0) {
      frequent = clinic;
      frequentSource = "clinic";
    }
  }

  const starredByCode = new Map(
    columns.starred.map((s) => [s.code?.toUpperCase() ?? "", s]),
  );
  const arsenal = [...new Set(pinnedCodes.map((raw) => raw.trim().toUpperCase()))]
    .filter(Boolean)
    .map((code) => {
      const s = starredByCode.get(code);
      return { code, name: s?.name ?? null, count: s?.count ?? 0 };
    });

  return {
    rows,
    frequent,
    frequentSource,
    starred: columns.starred,
    frequentLimit: normalizeFrequentLimit(doctor.frequentDiagnosisLimit),
    windowDays: days,
    arsenal,
  };
}
