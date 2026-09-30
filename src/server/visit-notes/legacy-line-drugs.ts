/**
 * Audit VW-05 — which catalog drug each free-text prescription line names,
 * for the treatment diff of the print and the handout.
 *
 * A line continuing a drug may use another of its names than the row it
 * continues («Конкор 5 мг» after a «Бисопролол» row): only the catalog
 * knows they are one drug. Resolved with the drug check's own matcher
 * (drug-text-match.ts), but over the few rows whose name, INN or brand
 * begins like one of the lines, not the whole catalog: the print preview
 * re-renders on every autosave.
 */
import {
  catalogSearchWords,
  catalogWordIdVariants,
  catalogWordVariants,
} from "@/lib/catalogs/search-fold";
import { prisma } from "@/lib/prisma";
import { buildDrugTextIndex, matchDrugLine } from "@/server/cds/drug-text-match";

/**
 * The first letters of a line's first word. Short enough to reach the
 * inflected form («Карбамазепина» → «карба») and the brand next to it.
 */
const HEAD_LETTERS = 5;

export async function resolveLineDrugIds(
  lines: readonly string[],
): Promise<(string | null)[]> {
  if (lines.length === 0) return [];
  // The line's first word as typed, in each spelling the catalog may use
  // («Аспирин C» → «аспир»; «Магне В6» → «магне»): the matcher's own key
  // folds Latin lookalikes into Cyrillic, which a database prefix on
  // «Paracetamol» would no longer find. The INN, a Latin name, only in the
  // spellings it can hold, as in the catalog search.
  const words = [
    ...new Set(
      lines
        .map((l) => catalogSearchWords(l)[0] ?? "")
        .filter((w) => w.length >= 3)
        .map((w) => w.slice(0, HEAD_LETTERS)),
    ),
  ];
  if (words.length === 0) return lines.map(() => null);
  const heads = [...new Set(words.flatMap((w) => catalogWordVariants(w)))];
  const innHeads = [...new Set(words.flatMap((w) => catalogWordIdVariants(w)))];

  const rows = await prisma.drug.findMany({
    where: {
      active: true,
      // Bare clinic quick-adds would shadow the real substance, as in the
      // drug check.
      NOT: { inn: { startsWith: "clinic:" } },
      OR: [
        ...heads.flatMap((h) => [
          { nameRu: { startsWith: h, mode: "insensitive" as const } },
          { brands: { some: { name: { startsWith: h, mode: "insensitive" as const } } } },
        ]),
        ...innHeads.map((h) => ({
          inn: { startsWith: h, mode: "insensitive" as const },
        })),
      ],
    },
    select: {
      id: true,
      inn: true,
      nameRu: true,
      atcCode: true,
      brands: { select: { name: true } },
    },
    take: 500,
  });
  const index = buildDrugTextIndex(rows);
  return lines.map((l) => matchDrugLine(index, l)?.drug.id ?? null);
}
