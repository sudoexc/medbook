/**
 * /api/crm/catalogs/drugs — searchable drug catalog (Phase G1).
 *
 * Platform-wide (not tenant-scoped): the catalog is curated globally so it
 * doesn't need a clinicId filter. Per-clinic overrides come later in G6 via
 * a thin overlay table.
 *
 * Search ranks: exact INN match → brand exact → name prefix → contains.
 * The drawer UI (⌘K) hits this with `?q=` on every keystroke (debounced).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { loadHiddenCodes } from "@/server/catalog/clinic-overlay";
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
  brands: { id: string; name: string; manufacturer: string | null }[];
};

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryDrugSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

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

    if (q.q && q.q.trim()) {
      const term = q.q.trim();
      where.OR = [
        { nameRu: { contains: term, mode: "insensitive" } },
        { nameUz: { contains: term, mode: "insensitive" } },
        { inn: { contains: term, mode: "insensitive" } },
        { id: { contains: term, mode: "insensitive" } },
        { brands: { some: { name: { contains: term, mode: "insensitive" } } } },
      ];
    }

    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const [allRows, hidden] = await Promise.all([
      prisma.drug.findMany({
        where,
        orderBy: { nameRu: "asc" },
        take: q.limit,
        include: { brands: true },
      }) as unknown as Promise<DrugRow[]>,
      loadHiddenCodes(clinicId, "DRUG"),
    ]);

    const rows = hidden.size > 0 ? allRows.filter((r) => !hidden.has(r.id)) : allRows;

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
