/**
 * Seeds DrugInteraction rows from `_drug-interactions-data.ts`.
 *
 * The table is a global catalog (no clinic owns a row) and this seed is its
 * only writer, so the source file is the whole truth: each run replaces the
 * full set. The replace is ONE transaction (audit G2-20): it used to delete
 * every pair and then insert them one by one, so a CDS check running during
 * the reseed, or after a crash halfway, saw an empty or partial table and
 * stayed silent about warfarin + aspirin. Under Postgres' read committed a
 * concurrent check keeps reading the old set until the commit.
 *
 * Pairs naming a drug the catalog does not have are skipped and reported as
 * an error (exit code 1): run prisma/seed-drugs.ts first.
 *
 * Migrations do not fill this table: on a fresh server it is empty and the
 * CDS finds only the class rules in code until this seed runs (RUNBOOK §5.1).
 *
 * Local: `npx tsx prisma/seed-drug-interactions.ts`
 *
 * Production (the worker image carries prisma/):
 * `docker compose exec -T worker npx tsx prisma/seed-drug-interactions.ts`
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { DRUG_INTERACTIONS, planDrugInteractionRows } from "./_drug-interactions-data";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const drugs = await prisma.drug.findMany({ select: { id: true } });
  const { rows, skipped } = planDrugInteractionRows(
    DRUG_INTERACTIONS,
    new Set(drugs.map((d) => d.id)),
  );

  const [removed, created] = await prisma.$transaction([
    prisma.drugInteraction.deleteMany({}),
    prisma.drugInteraction.createMany({ data: rows }),
  ]);

  console.log(
    `Seeded ${created.count} drug interactions (replaced ${removed.count}).`,
  );
  if (skipped.length > 0) {
    console.error(
      `ERROR: skipped ${skipped.length} pairs, drug missing from the catalog (run prisma/seed-drugs.ts first):`,
      skipped,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
