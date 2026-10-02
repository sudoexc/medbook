/**
 * Audit CT-15 data fix: register rows filed under the wrong category.
 *
 * The register payload's mapping filed ATC A10 (metformin, the insulins,
 * the gliflozins) under GI and the M03 muscle relaxants (tolperisone,
 * tizanidine) under OTHER, so «Инсулин аспарт» read «ЖКТ» on its card and
 * the category filter hid it from «Эндокринология». The import now corrects
 * the payload (`REGISTER_CATEGORY_FIXES` in `_registry-plan.ts`); this
 * script moves the rows an earlier import already wrote.
 *
 * Only global register rows (id «uzr-…», no clinic) still in the wrong
 * category are touched: curated rows carry their own category, and a row
 * someone filed elsewhere since is left as it is.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-ct15-register-categories.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-ct15-register-categories.ts
 *
 * Idempotent: a second run finds nothing to move.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type DrugCategory } from "../src/generated/prisma/client";
import { REGISTER_CATEGORY_FIXES } from "./_registry-plan";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

function whereFor(fix: (typeof REGISTER_CATEGORY_FIXES)[number]) {
  return {
    id: { startsWith: "uzr-" },
    clinicId: null,
    category: fix.from as DrugCategory,
    // The register carries a few lowercase codes.
    atcCode: { startsWith: fix.atc, mode: "insensitive" as const },
  };
}

async function main() {
  let total = 0;
  for (const fix of REGISTER_CATEGORY_FIXES) {
    const rows = await prisma.drug.findMany({
      where: whereFor(fix),
      select: { id: true, nameRu: true, atcCode: true },
      orderBy: { nameRu: "asc" },
    });
    console.log(`[ct15] ATC ${fix.atc}: ${rows.length} row(s) ${fix.from} → ${fix.to}`);
    for (const r of rows) console.log(`  ${r.nameRu} (${r.id}, ${r.atcCode})`);
    total += rows.length;
    if (APPLY && rows.length > 0) {
      const res = await prisma.drug.updateMany({
        where: whereFor(fix),
        data: { category: fix.to as DrugCategory },
      });
      console.log(`[ct15] ATC ${fix.atc}: updated ${res.count} row(s)`);
    }
  }
  if (total === 0) console.log("[ct15] nothing to do");
  else if (!APPLY) console.log("[ct15] DRY RUN: nothing written; run again with APPLY=1");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
