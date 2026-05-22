/**
 * Seeds DrugInteraction rows from `_drug-interactions-data.ts`.
 *
 * Idempotent: wipes all rows then re-inserts. Drug ids that don't resolve
 * (e.g. catalog renamed an INN) are skipped with a warning so a partial
 * seed still applies.
 *
 * Local: `npx tsx prisma/seed-drug-interactions.ts`
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { DRUG_INTERACTIONS } from "./_drug-interactions-data";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const drugs = await prisma.drug.findMany({ select: { id: true } });
  const known = new Set(drugs.map((d) => d.id));

  await prisma.drugInteraction.deleteMany({});

  let created = 0;
  const skipped: string[] = [];
  for (const it of DRUG_INTERACTIONS) {
    if (!known.has(it.a) || !known.has(it.b)) {
      skipped.push(`${it.a} ↔ ${it.b}`);
      continue;
    }
    // Normalise pair order so we never insert mirror duplicates.
    const [drugAId, drugBId] = it.a < it.b ? [it.a, it.b] : [it.b, it.a];
    await prisma.drugInteraction.create({
      data: {
        drugAId,
        drugBId,
        severity: it.severity,
        mechanism: it.mechanism ?? null,
        advice: it.advice,
        riskDiagnoses: it.riskDiagnoses ?? [],
      },
    });
    created += 1;
  }

  console.log(`Seeded ${created} drug interactions.`);
  if (skipped.length > 0) {
    console.warn(`Skipped ${skipped.length} pairs (drug missing):`, skipped);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
