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
 * Search ranks: exact INN match → brand exact → name prefix → contains.
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

    // Scope + search are both OR-groups — AND them so a search term can't
    // accidentally widen visibility to other clinics' rows.
    const and: Record<string, unknown>[] = [
      { OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])] },
    ];
    // «Конкор 5» searches for Конкор: doctors type the dose right after the
    // name, and a whole-string `contains` then finds nothing at all.
    const rawTerm = q.q?.trim() ?? "";
    const term = stripDoseFromName(rawTerm) || rawTerm;
    const tenant = ctx.kind === "TENANT";
    // The clinic's own names («Летирам», «Мускамед») match as part of the
    // search itself, so every filter, the total and paging treat them like
    // any other match.
    const formularyHits =
      tenant && term ? await searchFormulary(term, 20) : [];
    if (term) {
      and.push({
        OR: [
          { nameRu: { contains: term, mode: "insensitive" } },
          { nameUz: { contains: term, mode: "insensitive" } },
          { inn: { contains: term, mode: "insensitive" } },
          { id: { contains: term, mode: "insensitive" } },
          { brands: { some: { name: { contains: term, mode: "insensitive" } } } },
          ...(formularyHits.length > 0
            ? [{ id: { in: formularyHits.map((f) => f.drugId) } }]
            : []),
        ],
      });
    }
    where.AND = and;

    // A typeahead (the visit screen's search box: first page, a short list,
    // no other filter) must show a clinic-name hit even when the alphabetical
    // page would cut it: «Кеппра» must not lose to twelve earlier «Ке…».
    const typeahead =
      term.length > 0 &&
      q.offset === 0 &&
      q.limit <= 30 &&
      !includeHidden &&
      !q.category &&
      !q.atc &&
      !q.indication &&
      !q.forDiagnosis &&
      q.rxOnly === undefined &&
      !q.withDosing &&
      !q.noPhoto &&
      !(q.ids && q.ids.trim()) &&
      (q.active ?? true) === true;

    const [pageRows, overlays, matchedTotal, formulary] =
      await Promise.all([
        prisma.drug.findMany({
          where,
          orderBy: { nameRu: "asc" },
          skip: q.offset,
          take: q.limit,
          include: { brands: true },
        }) as unknown as Promise<DrugRow[]>,
        loadClinicOverlays(clinicId, "DRUG"),
        // The real number of matches, not the page size: the reference browser
        // pages through ~2.7k rows and must know when to stop offering «ещё».
        prisma.drug.count({ where }),
        tenant ? loadFormulary() : Promise.resolve([] as FormularyEntry[]),
      ]);

    let allRows = pageRows;
    const seen = new Set(pageRows.map((r) => r.id));
    const extraIds = typeahead
      ? formularyHits.map((f) => f.drugId).filter((id) => !seen.has(id)).slice(0, 8)
      : [];
    if (extraIds.length > 0) {
      // Same `where`, narrowed to the missing ids: every visibility rule
      // still applies to them.
      const extra = (await prisma.drug.findMany({
        where: { ...where, id: { in: extraIds } },
        include: { brands: true },
      })) as unknown as DrugRow[];
      allRows = [...extra, ...pageRows];
    }
    if (formulary.length > 0) {
      const byDrug = new Map(formulary.map((f) => [f.drugId, f]));
      allRows = allRows.map((r) => {
        const f = byDrug.get(r.id);
        return f ? { ...r, brands: [...formularyBrands(f), ...r.brands] } : r;
      });
    }
    const formularyRank = new Map(
      formularyHits.map((f, i) => [f.drugId, formularyHits.length - i]),
    );

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

    // Re-rank: items where the query string matches exactly (INN or brand)
    // bubble to the top so /q=bisoprolol returns bisoprolol first.
    if (term) {
      const needle = term.toLowerCase();
      const score = (d: DrugRow) =>
        (formularyRank.has(d.id) ? 1000 + formularyRank.get(d.id)! : 0) +
        rank(d, needle);
      rows.sort((a, b) => score(b) - score(a));
    }

    // `total` counts matches in the database (pre-paging); `rows` is this
    // page after clinic-hidden overlays are dropped (plus, for a typeahead,
    // up to 8 clinic-name hits the alphabetical page had cut).
    return ok({ rows, total: matchedTotal, offset: q.offset });
  },
);

function rank(d: DrugRow, needle: string): number {
  const inn = d.inn.toLowerCase();
  const id = d.id.toLowerCase();
  const ru = d.nameRu.toLowerCase();
  const brands = d.brands.map((b) => b.name.toLowerCase());

  if (id === needle || inn === needle) return 100;
  if (brands.includes(needle)) return 90;
  if (id.startsWith(needle) || inn.startsWith(needle) || ru.startsWith(needle)) return 50;
  if (brands.some((b) => b.startsWith(needle))) return 40;
  return 0;
}
