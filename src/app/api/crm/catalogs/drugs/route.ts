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
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  applyClinicOverlay,
  loadClinicOverlays,
} from "@/server/catalog/clinic-overlay";
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

    // Scope + search are both OR-groups — AND them so a search term can't
    // accidentally widen visibility to other clinics' rows.
    const and: Record<string, unknown>[] = [
      { OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])] },
    ];
    if (q.q && q.q.trim()) {
      const term = q.q.trim();
      and.push({
        OR: [
          { nameRu: { contains: term, mode: "insensitive" } },
          { nameUz: { contains: term, mode: "insensitive" } },
          { inn: { contains: term, mode: "insensitive" } },
          { id: { contains: term, mode: "insensitive" } },
          { brands: { some: { name: { contains: term, mode: "insensitive" } } } },
        ],
      });
    }
    where.AND = and;

    const [allRows, overlays] = await Promise.all([
      prisma.drug.findMany({
        where,
        orderBy: { nameRu: "asc" },
        take: q.limit,
        include: { brands: true },
      }) as unknown as Promise<DrugRow[]>,
      loadClinicOverlays(clinicId, "DRUG"),
    ]);

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
    if (q.q && q.q.trim()) {
      const needle = q.q.trim().toLowerCase();
      rows.sort((a, b) => rank(b, needle) - rank(a, needle));
    }

    return ok({ rows, total: rows.length });
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
