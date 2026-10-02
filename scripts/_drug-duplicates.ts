/**
 * Audit G4-21: the drugs the catalog extension (prisma/_drug-catalog-extra.ts)
 * added a second time under another id, and where each one belongs.
 *
 * Each copy repeated a curated row of the same composition and the same
 * brands (Наком, Магне B6, Панангин, Аквадетрим), but without what the
 * curated row carries: ATC code, pregnancy category, dosing, interaction
 * pairs. A search for «Магне B6» showed two cards, and the check of a
 * prescription depended on which one the doctor had clicked. The copies are
 * gone from the seed; `fix-g4-21-duplicate-drugs.ts` merges the live rows.
 *
 * Pure, shared by the data fix and the tests.
 */
import { normName } from "./_registry-plan";

/** A copy and the curated row it repeats. */
export const DUPLICATE_DRUGS: readonly { from: string; to: string }[] = [
  { from: "levodopa-carbidopa", to: "levodopa_carbidopa" },
  { from: "colecalciferol", to: "vitamin_d3" },
  { from: "magnesium-b6", to: "magnesium_b6" },
  { from: "potassium-magnesium-asparaginate", to: "potassium_mg_asparaginate" },
];

/**
 * A brand filed on a row of another composition. «Железа сульфат» is a drug
 * of its own (Тардиферон), but Сорбифер Дурулес is ferrous sulfate WITH
 * ascorbic acid, the curated iron_sorbifer, where its pairs with the proton
 * pump inhibitors live. A prescription written under the brand moves with
 * it.
 */
export const MISFILED_BRANDS: readonly {
  brand: string;
  from: string;
  to: string;
}[] = [{ brand: "Сорбифер Дурулес", from: "ferrous-sulfate", to: "iron_sorbifer" }];

/**
 * What happens to each brand row of a copy: moved to the curated row, or
 * deleted where the curated row already has the brand (case, ® and spacing
 * folded).
 */
export function planBrandMerge(
  fromBrands: readonly { id: string; name: string }[],
  toBrands: readonly { name: string }[],
): { move: string[]; drop: string[] } {
  const have = new Set(toBrands.map((b) => normName(b.name)));
  const move: string[] = [];
  const drop: string[] = [];
  for (const b of fromBrands) {
    const key = normName(b.name);
    if (have.has(key)) {
      drop.push(b.id);
    } else {
      have.add(key);
      move.push(b.id);
    }
  }
  return { move, drop };
}

/**
 * The clinic's core-list entry for the curated row after the copy's entry is
 * folded into it: the copy's label and aliases become aliases, so every name
 * the clinic's doctors search by still finds the drug.
 */
export function mergeFormularyAliases(
  keep: { label: string; aliases: readonly string[] },
  gone: { label: string; aliases: readonly string[] },
): string[] {
  const seen = new Set([normName(keep.label)]);
  const out: string[] = [];
  for (const a of [...keep.aliases, gone.label, ...gone.aliases]) {
    const key = normName(a);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * Structured prescription drafts (ClinicalProtocol.prescriptionItems) with
 * the copy's id replaced by the curated one. Null when nothing changes.
 */
export function repointDrafts(
  items: unknown,
  from: string,
  to: string,
): unknown[] | null {
  if (!Array.isArray(items)) return null;
  let changed = false;
  const out = items.map((it) => {
    if (it && typeof it === "object" && (it as { drugId?: unknown }).drugId === from) {
      changed = true;
      return { ...(it as Record<string, unknown>), drugId: to };
    }
    return it;
  });
  return changed ? out : null;
}
