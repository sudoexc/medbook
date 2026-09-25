/**
 * The clinic's core drug list (ClinicFormularyDrug) — read side.
 *
 * Two jobs:
 *   1. The «основные препараты клиники» section a doctor sees on tapping the
 *      drug field (see /api/crm/doctors/me/drug-shortlist).
 *   2. Search by the clinic's own vocabulary: «Летирам», «Кеппра» and
 *      «Анаприлин» must find the drug even though the global register
 *      files them under another trade name or the substance.
 *
 * The model carries `clinicId`, so the tenant extension scopes every query
 * here to the caller's clinic.
 */
import { prisma } from "@/lib/prisma";

/** Lowercase, ё→е, collapsed whitespace — the formulary search key. */
export function normalizeCatalogTerm(raw: string): string {
  return raw.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/**
 * The drug name without the dose a doctor types after it: «Конкор 5»,
 * «Кеторол 10 мг», «Амоксиклав 875/125», «Мексидол 5,0 №10» → the bare name.
 * Used before creating a clinic drug, so a brand typed with its strength
 * lands on the real catalog row (with its substance, allergy and
 * interaction data) instead of becoming a blind duplicate.
 */
export function stripDoseFromName(raw: string): string {
  const UNIT = /^(мг|мл|мкг|г|ед|ме|%|mg|ml|mcg|g|iu|таб|табл|капс|амп)\.?$/i;
  const tokens = raw.replace(/\s+/g, " ").trim().split(" ");
  const kept: string[] = [];
  for (const tok of tokens) {
    const t = tok.replace(/[(),;]+/g, "");
    if (!t) continue;
    if (/^№\s*\d+$/.test(t)) continue;
    // «5», «0,5», «10мг», «875/125», «2,5%»
    if (/^\d+([.,]\d+)?(\/\d+([.,]\d+)?)?(мг|мл|мкг|г|ед|%|mg|ml)?$/i.test(t)) continue;
    if (UNIT.test(t)) continue;
    kept.push(tok);
  }
  return kept.join(" ").trim();
}

/** Build `searchText` from the clinic label and its aliases. */
export function formularySearchText(label: string, aliases: string[]): string {
  return normalizeCatalogTerm([label, ...aliases].join(" | "));
}

export type FormularyEntry = {
  drugId: string;
  label: string;
  aliases: string[];
  strengths: string[];
  sortOrder: number;
};

/** The clinic's whole list, in the clinic's order. Small (~50 rows). */
export async function loadFormulary(): Promise<FormularyEntry[]> {
  const rows = await prisma.clinicFormularyDrug.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: {
      drugId: true,
      label: true,
      aliases: true,
      strengths: true,
      sortOrder: true,
    },
  });
  return rows;
}

/**
 * Formulary entries whose label or alias contains the term. Used by the
 * catalog search to surface «Кеппра» → Летирам first.
 */
export async function searchFormulary(
  rawTerm: string,
  limit: number,
): Promise<FormularyEntry[]> {
  const term = normalizeCatalogTerm(rawTerm);
  if (term.length < 2) return [];
  return prisma.clinicFormularyDrug.findMany({
    where: { searchText: { contains: term } },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    take: limit,
    select: {
      drugId: true,
      label: true,
      aliases: true,
      strengths: true,
      sortOrder: true,
    },
  });
}

/**
 * The clinic's names for a drug, as pseudo-brands. Search results and the
 * prescription label already lead with the brand the doctor typed
 * (`matchedBrand`), so exposing «Летирам»/«Кеппра» as brands of the row makes
 * the whole UI speak the clinic's language without a second display path.
 */
export function formularyBrands(
  entry: Pick<FormularyEntry, "drugId" | "label" | "aliases">,
): { id: string; name: string; manufacturer: null }[] {
  return [entry.label, ...entry.aliases].map((name, i) => ({
    id: `clinic-alias:${entry.drugId}:${i}`,
    name,
    manufacturer: null,
  }));
}
