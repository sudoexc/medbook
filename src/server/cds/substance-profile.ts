/**
 * What a catalog row stands for, substance by substance (audit G4-08).
 *
 * The state register import gives its own row to substances the curated
 * catalog already knows: «Тромбо АСС» (B01AC06) next to aspirin_cardio,
 * «КЛОСАРТ» (C09CA01) next to losartan, «КАРБАЛЕКС» (N03AF01) next to
 * carbamazepine, a «Диклофенак натрия» with no ATC code at all, and
 * combinations («Бетаметазон + гидроксокобаламин + диклофенак»). Those rows
 * carry none of the clinical data: curated pairs are keyed on ids, the
 * pregnancy category stays UNKNOWN, contraindications are empty. One
 * substance was checked or not depending on which card the doctor picked.
 *
 * The engine now looks at a drug through its substances:
 *   - twins: other catalog rows with the same full (7-character) ATC code,
 *     which WHO assigns per chemical substance. Their curated pairs,
 *     pregnancy category and contraindications apply to the drug;
 *   - components: a combination («A + B»), or a row without any ATC code,
 *     is split into the substances it names, each resolved to the catalog
 *     row of that name (and its twins). Class rules, duplicate therapy,
 *     allergy, pregnancy and contraindications then see the diclofenac
 *     inside «Диоксафлекс B12».
 * Nothing is invented: every value still comes from a curated row of the
 * same substance.
 */
import type { PregnancyCat } from "./pregnancy";

/** The catalog fields the substance view needs. */
export type SubstanceRow = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: PregnancyCat;
  contraindications: string[];
  brands: { name: string }[];
};

/** The ATC code when it names one substance (level 5), else null. */
export function fullAtc(atc: string | null | undefined): string | null {
  const a = atc?.trim().toUpperCase() ?? "";
  return a.length >= 7 ? a : null;
}

/**
 * «Бетаметазон + гидроксокобаламин + диклофенак» → its three names. A name
 * without «+» is not a combination: [].
 */
export function combinationParts(nameRu: string): string[] {
  const core = nameRu.replace(/\([^)]*\)/g, " ");
  const parts = core
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  return parts.length >= 2 ? parts : [];
}

/**
 * The names to resolve to catalog substances: the parts of a combination,
 * or the whole name of a row that has no ATC code at all («Диклофенак
 * натрия» from the register). A row with its own ATC code needs none.
 */
export function componentNames(d: { nameRu: string; atcCode: string | null }): string[] {
  const parts = combinationParts(d.nameRu);
  if (parts.length > 0) return parts;
  return d.atcCode?.trim() ? [] : [d.nameRu];
}

/** Rows of the same substance as `row`, found among `candidates`. */
export function twinsOf<R extends SubstanceRow>(row: R, candidates: readonly R[]): R[] {
  const atc = fullAtc(row.atcCode);
  if (!atc) return [];
  return candidates.filter((c) => c.id !== row.id && fullAtc(c.atcCode) === atc);
}

const CAT_RANK: Record<PregnancyCat, number> = {
  X: 5,
  D: 4,
  C: 3,
  B: 2,
  A: 1,
  UNKNOWN: 0,
};

/** The strictest known category, UNKNOWN when none is known. */
export function strictestCategory(cats: readonly PregnancyCat[]): PregnancyCat {
  let best: PregnancyCat = "UNKNOWN";
  for (const c of cats) if (CAT_RANK[c] > CAT_RANK[best]) best = c;
  return best;
}

/** Contraindication lines of a drug: its own, else those of its substances. */
export function contraindicationLines(
  own: SubstanceRow,
  others: readonly SubstanceRow[],
): string[] {
  if (own.contraindications.length > 0) return own.contraindications;
  return [...new Set(others.flatMap((o) => o.contraindications))];
}
