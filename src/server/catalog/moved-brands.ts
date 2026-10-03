/**
 * His structured history with every use whose label a catalog repair moved
 * to another row re-pinned there (see `repinDrugUses`, audit CT-03 review).
 *
 * Shared by every route that turns his past rows into one-click picks (the
 * drug shortlist and its columns, the diagnosis memory): a pick built on a
 * stale pin makes a new row pinned to the wrong substance, and the CDS check,
 * which trusts the id, then stays silent about it.
 *
 * The whole catalog is read only when some label no longer names its own
 * drug; it is the set the CDS check reads for text lines (active rows, not
 * quick added «clinic:» ones), limited to what this clinic may see.
 */
import { prisma } from "@/lib/prisma";
import {
  formularyBrands,
  type FormularyEntry,
} from "@/server/catalog/formulary";
import {
  hasStaleDrugUse,
  repinDrugUses,
  type StructuredDrugUse,
} from "@/server/catalog/shortlist";
import {
  buildDrugTextIndex,
  type TextMatchDrug,
} from "@/server/cds/drug-text-match";

const NAME_SELECT = {
  id: true,
  inn: true,
  nameRu: true,
  atcCode: true,
  brands: { select: { name: true } },
} as const;

/** A drug with the clinic's own names for it (core list) added as brands. */
function withClinicNames(
  d: TextMatchDrug,
  byDrug: ReadonlyMap<string, FormularyEntry>,
): TextMatchDrug {
  const f = byDrug.get(d.id);
  return f
    ? { ...d, brands: [...formularyBrands(f).map((b) => ({ name: b.name })), ...d.brands] }
    : d;
}

export async function followMovedBrands<U extends StructuredDrugUse>(
  uses: U[],
  clinicId: string,
  formulary: FormularyEntry[],
): Promise<U[]> {
  const ids = [...new Set(uses.map((u) => u.drugId).filter((id): id is string => !!id))];
  if (ids.length === 0) return uses;
  const byDrug = new Map(formulary.map((f) => [f.drugId, f]));

  const pinned = await prisma.drug.findMany({
    where: { id: { in: ids } },
    select: NAME_SELECT,
  });
  const current = new Map(pinned.map((d) => [d.id, withClinicNames(d, byDrug)]));
  if (!hasStaleDrugUse(uses, current)) return uses;

  const rows = await prisma.drug.findMany({
    where: {
      active: true,
      OR: [{ clinicId: null }, { clinicId }],
      NOT: { inn: { startsWith: "clinic:" } },
    },
    select: NAME_SELECT,
  });
  const catalog = buildDrugTextIndex(rows.map((d) => withClinicNames(d, byDrug)));
  return repinDrugUses({ uses, current, catalog });
}
