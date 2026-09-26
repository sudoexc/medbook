/**
 * /api/crm/catalogs/drugs — searchable drug catalog (Phase G1, Ф4).
 *
 * Visibility = global rows (clinicId null, minus the clinic's DRUG overlay
 * hides, with `overridesJson` patches applied) + the clinic's own rows.
 * Drug is in MODELS_WITHOUT_TENANT, so the clinic filter here is explicit.
 *
 * `?includeHidden=1` (ADMIN only — the Ф4 knowledge settings screen) keeps
 * hidden globals in the response and flags them `hiddenByClinic: true`
 * instead of filtering, so the admin can un-hide them.
 *
 * Search ranks: the clinic's own names → exact id/INN/name → brand exact →
 * prefix → contains, and the order is decided BEFORE paging (see
 * `@/server/catalog/drug-rank`): ranking only the alphabetical first page
 * lost «Парацетамол» behind a dozen combinations that contain it.
 * The drawer UI (⌘K) hits this with `?q=` on every keystroke (debounced).
 *
 * The clinic's core list (ClinicFormularyDrug) takes part too: its label and
 * aliases are the names the clinic's doctors actually use («Летирам»,
 * «Кеппра»), so a match there is served first, and every row the clinic
 * lists carries those names as extra brands.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  applyClinicOverlay,
  loadClinicOverlays,
} from "@/server/catalog/clinic-overlay";
import {
  orderStrongTier,
  splitPageWindow,
  strongMatchWhere,
} from "@/server/catalog/drug-rank";
import {
  formularyBrands,
  loadFormulary,
  searchFormulary,
  stripDoseFromName,
  type FormularyEntry,
} from "@/server/catalog/formulary";
import { ok, parseQuery } from "@/server/http";
import { QueryDrugSchema } from "@/server/schemas/drug";
import type { DrugCategory, PregnancyCategory } from "@/generated/prisma/client";

type DrugRow = {
  id: string;
  inn: string;
  nameRu: string;
  nameUz: string | null;
  atcCode: string | null;
  category: DrugCategory;
  forms: unknown;
  indications: string[];
  contraindications: string[];
  sideEffects: string[];
  pregnancyCat: PregnancyCategory;
  defaultDosing: unknown;
  rxOnly: boolean;
  active: boolean;
  photoUrl: string | null;
  clinicId: string | null;
  brands: { id: string; name: string; manufacturer: string | null }[];
};

/**
 * Most strong-tier rows a search ranks in memory. The whole catalog is ~3k
 * drugs and a real two-letter prefix matches a few hundred; hitting this
 * means a one-letter term, and such a request falls back to plain
 * alphabetical paging rather than rank a truncated tier (rows past the cap
 * would belong to neither tier and vanish from the pages).
 */
const STRONG_TIER_CAP = 1500;

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryDrugSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const includeHidden =
      new URL(request.url).searchParams.get("includeHidden") === "1" &&
      ctx.kind === "TENANT" &&
      ctx.role === "ADMIN";

    const where: Record<string, unknown> = { active: q.active ?? true };
    if (q.category) where.category = q.category;
    if (q.atc) where.atcCode = { startsWith: q.atc, mode: "insensitive" };
    if (q.indication) where.indications = { has: q.indication };
    if (q.forDiagnosis && q.forDiagnosis.trim()) {
      // "G43.0" → ["G43", "G43.", "G43.0"] — catalog indications are stored
      // as ICD prefixes of varying depth, so match any prefix of the code.
      const code = q.forDiagnosis.trim().toUpperCase();
      const prefixes = new Set<string>();
      for (let len = 3; len <= code.length; len += 1) {
        prefixes.add(code.slice(0, len));
      }
      where.indications = { hasSome: [...prefixes] };
    }

    if (q.rxOnly !== undefined) where.rxOnly = q.rxOnly;
    // Curated rows are the ones a doctor can lean on for dosing text; the
    // register import brought names and forms but no instructions.
    if (q.withDosing) where.defaultDosing = { not: null };
    // The photo worklist. Note this reads the GLOBAL column only: a clinic
    // photo stored in its overlay is filtered client-side, which is fine —
    // the worklist is about what is still missing, and an overlay row simply
    // drops out of the list once the page renders it as done.
    if (q.noPhoto) where.photoUrl = null;
    if (q.ids && q.ids.trim()) {
      const ids = q.ids
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 200);
      where.id = { in: ids };
    }

    // «Конкор 5» searches for Конкор: doctors type the dose right after the
    // name, and a whole-string `contains` then finds nothing at all.
    const rawTerm = q.q?.trim() ?? "";
    const term = stripDoseFromName(rawTerm) || rawTerm;
    const tenant = ctx.kind === "TENANT";
    // The clinic's own names («Летирам», «Мускамед») match as part of the
    // search itself, so every filter, the total and paging treat them like
    // any other match.
    const [overlays, formularyHits, formulary] = await Promise.all([
      loadClinicOverlays(clinicId, "DRUG"),
      tenant && term
        ? searchFormulary(term, 20)
        : Promise.resolve([] as FormularyEntry[]),
      tenant ? loadFormulary() : Promise.resolve([] as FormularyEntry[]),
    ]);
    const formularyIds = formularyHits.map((f) => f.drugId);

    // Scope + search are both OR-groups — AND them so a search term can't
    // accidentally widen visibility to other clinics' rows.
    const and: Record<string, unknown>[] = [
      { OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])] },
    ];
    // Globals the clinic hid are dropped in the query, not after it: a page
    // trimmed after the fact came back short, and `total` counted drugs the
    // doctor can never see. Ids are unique across the table, so this only
    // ever removes the hidden global rows.
    if (!includeHidden && overlays.hidden.size > 0) {
      and.push({ id: { notIn: [...overlays.hidden] } });
    }
    if (term) {
      and.push({
        OR: [
          { nameRu: { contains: term, mode: "insensitive" } },
          { nameUz: { contains: term, mode: "insensitive" } },
          { inn: { contains: term, mode: "insensitive" } },
          { id: { contains: term, mode: "insensitive" } },
          { brands: { some: { name: { contains: term, mode: "insensitive" } } } },
          ...(formularyIds.length > 0 ? [{ id: { in: formularyIds } }] : []),
        ],
      });
    }
    where.AND = and;

    const [pageRows, matchedTotal] = await Promise.all([
      term
        ? loadRankedPage(where, and, term, formularyIds, q.offset, q.limit)
        : (prisma.drug.findMany({
            where,
            orderBy: { nameRu: "asc" },
            skip: q.offset,
            take: q.limit,
            include: { brands: true },
          }) as unknown as Promise<DrugRow[]>),
      // The real number of matches, not the page size: the reference browser
      // pages through ~2.7k rows and must know when to stop offering «ещё».
      prisma.drug.count({ where }),
    ]);

    let allRows = pageRows;
    if (formulary.length > 0) {
      const byDrug = new Map(formulary.map((f) => [f.drugId, f]));
      allRows = allRows.map((r) => {
        const f = byDrug.get(r.id);
        return f ? { ...r, brands: [...formularyBrands(f), ...r.brands] } : r;
      });
    }

    const rows = allRows
      .filter(
        (r) =>
          r.clinicId !== null || includeHidden || !overlays.hidden.has(r.id),
      )
      .map((r) =>
        r.clinicId === null
          ? {
              ...applyClinicOverlay(
                r as unknown as Record<string, unknown>,
                r.id,
                overlays,
                "DRUG",
              ),
              hiddenByClinic: overlays.hidden.has(r.id),
            }
          : { ...r, clinicOverridden: false, hiddenByClinic: false },
      ) as Array<
      DrugRow & { clinicOverridden: boolean; hiddenByClinic: boolean }
    >;

    // `total` counts the visible matches (pre-paging); `rows` is this page,
    // already in search order.
    return ok({ rows, total: matchedTotal, offset: q.offset });
  },
);

/**
 * One page of a search, ranked before it is cut (audit CT-09). The strong
 * tier (id / INN / name / brand starts with the term, or the clinic's core
 * list names it) is ranked in memory from its keys alone; the rest only
 * contain the term and page alphabetically in the database. Both tiers carry
 * the full `where`, so every filter and visibility rule applies to each.
 */
async function loadRankedPage(
  where: Record<string, unknown>,
  and: Record<string, unknown>[],
  term: string,
  formularyIds: string[],
  offset: number,
  limit: number,
): Promise<DrugRow[]> {
  const strong = strongMatchWhere(term, formularyIds);
  const keys = await prisma.drug.findMany({
    where: { ...where, AND: [...and, strong] },
    select: { id: true, inn: true, nameRu: true, brands: { select: { name: true } } },
    orderBy: { nameRu: "asc" },
    take: STRONG_TIER_CAP,
  });
  if (keys.length >= STRONG_TIER_CAP) {
    return (await prisma.drug.findMany({
      where,
      orderBy: { nameRu: "asc" },
      skip: offset,
      take: limit,
      include: { brands: true },
    })) as unknown as DrugRow[];
  }

  const ranked = orderStrongTier(keys, term, formularyIds);
  const win = splitPageWindow(ranked.length, offset, limit);
  const strongIds = ranked.slice(win.strongStart, win.strongEnd).map((r) => r.id);
  const [strongRows, restRows] = await Promise.all([
    strongIds.length > 0
      ? (prisma.drug.findMany({
          where: { id: { in: strongIds } },
          include: { brands: true },
        }) as unknown as Promise<DrugRow[]>)
      : Promise.resolve([] as DrugRow[]),
    win.restTake > 0
      ? (prisma.drug.findMany({
          where: { ...where, AND: [...and, { NOT: strong }] },
          orderBy: { nameRu: "asc" },
          skip: win.restSkip,
          take: win.restTake,
          include: { brands: true },
        }) as unknown as Promise<DrugRow[]>)
      : Promise.resolve([] as DrugRow[]),
  ]);
  const byId = new Map(strongRows.map((r) => [r.id, r]));
  return [
    ...strongIds.map((id) => byId.get(id)).filter((r): r is DrugRow => !!r),
    ...restRows,
  ];
}
