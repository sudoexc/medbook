/**
 * Drug catalog search order, decided BEFORE paging.
 *
 * The route used to take the first `limit` matches alphabetically and rank
 * only that page. After the state-register import «парацетамол» matches 26
 * rows and the plain «Парацетамол» sorts 18th, behind «Аскорбиновая кислота +
 * лоратадин + парацетамол + …»: the twelve-row typeahead never saw it, so
 * there was nothing to rank to the top (audit CT-09).
 *
 * Matches split into two tiers, and paging walks them in order:
 *   - strong: the id, INN, name or a brand equals or starts with the term, or
 *     the clinic's core list names it. Small even for a two-letter term, so
 *     it is fetched whole (keys only) and ranked here.
 *   - rest: the term is only somewhere inside a name. Every row there ranks
 *     the same, so the database pages it alphabetically as before.
 * Page N is then exactly the N-th slice of one fixed order: the reference
 * browser, which scrolls through a search 100 rows at a time, neither skips
 * nor repeats a drug between pages.
 */
import { normalizeCatalogTerm } from "./formulary";

export type DrugRankKeys = {
  id: string;
  inn: string;
  nameRu: string;
  brands: { name: string }[];
};

/**
 * The database side of the strong tier: the same fields `rankDrugMatch`
 * reads, as a Prisma `where` fragment. Only non-null columns take part (so
 * not nameUz), because the rest tier is its negation, and `NOT (col ILIKE
 * …)` on a NULL column is NULL in SQL: the row would silently drop out of
 * both tiers.
 */
export function strongMatchWhere(
  term: string,
  formularyIds: string[],
): Record<string, unknown> {
  return {
    OR: [
      { id: { startsWith: term, mode: "insensitive" } },
      { inn: { startsWith: term, mode: "insensitive" } },
      { nameRu: { startsWith: term, mode: "insensitive" } },
      { brands: { some: { name: { startsWith: term, mode: "insensitive" } } } },
      ...(formularyIds.length > 0 ? [{ id: { in: formularyIds } }] : []),
    ],
  };
}

/**
 * How strongly one drug matches the typed term. 0 = the term is only inside
 * a name («аскорбиновая кислота + парацетамол» for «парацетамол»).
 */
export function rankDrugMatch(d: DrugRankKeys, rawNeedle: string): number {
  const needle = normalizeCatalogTerm(rawNeedle);
  if (!needle) return 0;
  const own = [d.id, d.inn, d.nameRu].map(normalizeCatalogTerm);
  const brands = d.brands.map((b) => normalizeCatalogTerm(b.name));
  if (own.includes(needle)) return 100;
  if (brands.includes(needle)) return 90;
  if (own.some((v) => v.startsWith(needle))) return 50;
  if (brands.some((b) => b.startsWith(needle))) return 40;
  return 0;
}

/**
 * The strong tier in search order. The clinic's own names («Кеппра» →
 * Летирам) lead, in the clinic's order; then exact, brand, prefix. Rows
 * arrive alphabetically and the sort is stable, so equal scores keep that
 * order and the whole thing is deterministic across requests.
 */
export function orderStrongTier<T extends DrugRankKeys>(
  rows: T[],
  needle: string,
  formularyIds: string[],
): T[] {
  const formularyRank = new Map(
    formularyIds.map((id, i) => [id, formularyIds.length - i]),
  );
  return rows
    .map((row, i) => ({
      row,
      i,
      score:
        (formularyRank.has(row.id) ? 1000 + formularyRank.get(row.id)! : 0) +
        rankDrugMatch(row, needle),
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.row);
}

/**
 * Where one page window [offset, offset + limit) falls across the two tiers:
 * which slice of the ranked strong tier, then how many alphabetical rest
 * rows to skip and take.
 */
export function splitPageWindow(
  strongCount: number,
  offset: number,
  limit: number,
): { strongStart: number; strongEnd: number; restSkip: number; restTake: number } {
  const strongStart = Math.min(offset, strongCount);
  const strongEnd = Math.min(offset + limit, strongCount);
  return {
    strongStart,
    strongEnd,
    restSkip: Math.max(0, offset - strongCount),
    restTake: limit - (strongEnd - strongStart),
  };
}
