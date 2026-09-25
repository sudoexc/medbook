/**
 * Load drugs by id the way the doctor-facing search returns them: only rows
 * this clinic may see (global + its own), active, global rows with the
 * clinic's overlay applied (hidden ones dropped), and the clinic's own names
 * from its core list prepended as brands.
 *
 * Shared by the shortlist endpoints so a drug picked from «мои частые»
 * carries exactly the same shape as one picked from search.
 */
import { prisma } from "@/lib/prisma";
import {
  applyClinicOverlay,
  loadClinicOverlays,
} from "@/server/catalog/clinic-overlay";
import {
  formularyBrands,
  type FormularyEntry,
} from "@/server/catalog/formulary";

export type DrugHit = {
  id: string;
  inn: string;
  nameRu: string;
  nameUz: string | null;
  atcCode: string | null;
  category: string;
  forms: unknown;
  defaultDosing: unknown;
  rxOnly: boolean;
  photoUrl: string | null;
  clinicId: string | null;
  brands: { id: string; name: string; manufacturer: string | null }[];
};

export async function loadDrugHits(
  ids: string[],
  clinicId: string | null,
  formulary: FormularyEntry[],
): Promise<Map<string, DrugHit>> {
  const unique = [...new Set(ids)].slice(0, 200);
  if (unique.length === 0) return new Map();

  const [rows, overlays] = await Promise.all([
    prisma.drug.findMany({
      where: {
        id: { in: unique },
        active: true,
        OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])],
      },
      select: {
        id: true,
        inn: true,
        nameRu: true,
        nameUz: true,
        atcCode: true,
        category: true,
        forms: true,
        defaultDosing: true,
        rxOnly: true,
        photoUrl: true,
        clinicId: true,
        brands: { select: { id: true, name: true, manufacturer: true } },
      },
    }),
    loadClinicOverlays(clinicId, "DRUG"),
  ]);

  const byFormulary = new Map(formulary.map((f) => [f.drugId, f]));
  const out = new Map<string, DrugHit>();
  for (const r of rows) {
    if (r.clinicId === null && overlays.hidden.has(r.id)) continue;
    const base =
      r.clinicId === null
        ? (applyClinicOverlay(
            r as unknown as Record<string, unknown>,
            r.id,
            overlays,
            "DRUG",
          ) as unknown as typeof r)
        : r;
    const f = byFormulary.get(r.id);
    out.set(r.id, {
      ...base,
      category: String(base.category),
      brands: f ? [...formularyBrands(f), ...base.brands] : base.brands,
    });
  }
  return out;
}
