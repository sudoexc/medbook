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
 *   - strong: the id, INN, name or a brand starts with the query's first
 *     word, or the clinic's core list names it. Small even for a two-letter
 *     term, so it is fetched whole (keys only) and ranked here on the whole
 *     query: exact, then brand, then prefix, then the rest of the tier.
 *   - rest: the words are only somewhere inside the names. Every row there
 *     ranks the same, so the database pages it alphabetically as before.
 * Page N is then exactly the N-th slice of one fixed order: the reference
 * browser, which scrolls through a search 100 rows at a time, neither skips
 * nor repeats a drug between pages.
 */
import {
  catalogSearchWords,
  catalogWordIdVariants,
  catalogWordVariants,
  foldCatalogPlain,
  foldCatalogText,
} from "@/lib/catalogs/search-fold";

export type DrugRankKeys = {
  id: string;
  inn: string;
  nameRu: string;
  brands: { name: string }[];
};

type Where = Record<string, unknown>;

/**
 * The search itself, as a Prisma `where` fragment: every word of the query
 * (see `catalogSearchWords`) is somewhere in the drug's names, each word in
 * any of its spellings (`catalogWordVariants`). Matching the whole typed
 * string at once found nothing for «аспирин с» against «АСПИРИН® С», or
 * for «магне в6» (Cyrillic В) against «МАГНЕ® B6». Words may sit in
 * different fields: «аспирин с» is a brand word and a letter of the name.
 * The id and the INN are Latin slugs and INNs, so they get only the
 * spellings a Latin identifier can hold (`catalogWordIdVariants`).
 * Null when the query has no word at all (only «+» or «®»).
 */
export function drugSearchWhere(term: string): Where | null {
  const words = catalogSearchWords(term);
  if (words.length === 0) return null;
  return {
    AND: words.map((word) => {
      const variants = catalogWordVariants(word);
      const has = (v: string) => ({ contains: v, mode: "insensitive" });
      return {
        OR: [
          ...variants.flatMap((v) => [{ nameRu: has(v) }, { nameUz: has(v) }]),
          ...catalogWordIdVariants(word).flatMap((v) => [
            { inn: has(v) },
            { id: has(v) },
          ]),
          { brands: { some: { OR: variants.map((v) => ({ name: has(v) })) } } },
        ],
      };
    }),
  };
}

/**
 * The database side of the strong tier: the id, INN, name or a brand starts
 * with the query's first word, in the spellings each field can hold (a
 * brand's ® comes after its first word, so «аспирин с» still reaches
 * «АСПИРИН® С» here); the full query is then weighed in memory by
 * `rankDrugMatch`, which compares the same way. Only
 * non-null columns take part (so not nameUz), because the rest tier is its
 * negation, and `NOT (col ILIKE …)` on a NULL column is NULL in SQL: the
 * row would silently drop out of both tiers.
 */
export function strongMatchWhere(
  term: string,
  formularyIds: string[],
): Where {
  const first = catalogSearchWords(term)[0];
  const heads = first ? catalogWordVariants(first) : [];
  const idHeads = first ? catalogWordIdVariants(first) : [];
  const starts = (v: string) => ({ startsWith: v, mode: "insensitive" });
  return {
    OR: [
      ...idHeads.flatMap((h) => [{ id: starts(h) }, { inn: starts(h) }]),
      ...heads.map((h) => ({ nameRu: starts(h) })),
      ...(heads.length > 0
        ? [{ brands: { some: { OR: heads.map((h) => ({ name: starts(h) })) } } }]
        : []),
      ...(formularyIds.length > 0 ? [{ id: { in: formularyIds } }] : []),
    ],
  };
}

/**
 * How strongly one drug matches the typed term. 0 = the term is only inside
 * a name («аскорбиновая кислота + парацетамол» for «парацетамол»).
 */
export function rankDrugMatch(d: DrugRankKeys, rawNeedle: string): number {
  // Folded like the search matched it: «аспирин c» is exactly «АСПИРИН® С».
  const needle = foldCatalogText(rawNeedle);
  if (!needle) return 0;
  // The Latin id and INN letter for letter, as `catalogWordIdVariants`
  // searched them: folded into Cyrillic, «hopantenic» started with «нор»
  // and «topiramate» with «тор», and led those searches.
  const plainNeedle = foldCatalogPlain(rawNeedle);
  const ids = [d.id, d.inn].map(foldCatalogPlain);
  const name = foldCatalogText(d.nameRu);
  const brands = d.brands.map((b) => foldCatalogText(b.name));
  if (name === needle || ids.includes(plainNeedle)) return 100;
  if (brands.includes(needle)) return 90;
  if (name.startsWith(needle) || ids.some((v) => v.startsWith(plainNeedle))) {
    return 50;
  }
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
