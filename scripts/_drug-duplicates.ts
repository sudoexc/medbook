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

/** A clinic's overlay on a global drug, as the merge reads it. */
export type DrugOverlayState = {
  hideGlobal: boolean;
  overrides: Record<string, unknown> | null;
};

export type OverlayMergePlan = {
  /** The clinic's overlay on the curated row after the merge; null when none is needed. */
  curated: DrugOverlayState | null;
  /** Something to write for this clinic (a copy overlay to fold, a hide to lift). */
  changed: boolean;
  /** The clinic hid the curated row while the copy was on screen: the hide is lifted. */
  liftedHide: boolean;
  /** The clinic hid the copy as a duplicate: that hide is dropped, never moved. */
  droppedHide: boolean;
  /** The copy carried a patch (photo, rename) that now lands on the curated row. */
  movedOverrides: boolean;
  /** The clinic hid both cards: the curated row stays hidden. */
  keptHidden: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** `top` over `base`; an object field (the dosing lines) merges key by key. */
function mergePatches(
  base: Record<string, unknown> | null,
  top: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, v] of Object.entries(top ?? {})) {
    out[key] = isPlainObject(v) && isPlainObject(out[key]) ? { ...out[key], ...v } : v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * One clinic's overlays when the copy folds into the curated row.
 *
 * A hide is never carried over: the settings page hides a global drug with
 * an overlay (`hideGlobal` defaults to true), and an admin who saw two
 * «Магне B6» cards hid the one they did not want. Moving that overlay hid
 * the curated row for the whole clinic; keeping the curated row's hide
 * while the copy was the visible card left the clinic with no card at all.
 * So the merged card is hidden only when the clinic hid both, and a
 * retired copy (`copyActive` false, a second run) counts as not on screen.
 *
 * The patches merge: where both set a field, the card the clinic looked at
 * wins (the curated one, unless only the copy was visible).
 */
export function planOverlayMerge(
  copy: DrugOverlayState | null,
  curated: DrugOverlayState | null,
  copyActive: boolean,
): OverlayMergePlan {
  const copySeen = copyActive && !(copy?.hideGlobal ?? false);
  const curatedSeen = !(curated?.hideGlobal ?? false);
  const hideGlobal = !copySeen && !curatedSeen;
  const fromCopy = copy?.overrides ?? null;
  const fromCurated = curated?.overrides ?? null;
  const overrides =
    copySeen && !curatedSeen
      ? mergePatches(fromCurated, fromCopy)
      : mergePatches(fromCopy, fromCurated);
  const liftedHide = (curated?.hideGlobal ?? false) && !hideGlobal;
  return {
    curated: hideGlobal || overrides ? { hideGlobal, overrides } : null,
    changed: copy !== null || liftedHide,
    liftedHide,
    droppedHide: (copy?.hideGlobal ?? false) && !hideGlobal,
    movedOverrides: fromCopy !== null && Object.keys(fromCopy).length > 0,
    keptHidden: copy !== null && hideGlobal,
  };
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
