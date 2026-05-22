/**
 * Seeds ClinicalProtocol rows from `_protocol-data.ts`.
 *
 * Idempotent: deletes existing protocols by `diagnosisCodePrefix`, then
 * re-inserts the curated bundle. Per-clinic overrides (G6) will be in a
 * separate overlay table so they survive reseeds.
 *
 * Local: `npx tsx prisma/seed-protocols.ts`
 * Prod: see seed-protocols-sql.ts for the raw SQL generator.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { PROTOCOLS } from "./_protocol-data";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const prefixes = PROTOCOLS.map((p) => p.diagnosisCodePrefix);
  await prisma.clinicalProtocol.deleteMany({
    where: { diagnosisCodePrefix: { in: prefixes } },
  });

  let count = 0;
  for (const p of PROTOCOLS) {
    await prisma.clinicalProtocol.create({
      data: {
        diagnosisCodePrefix: p.diagnosisCodePrefix,
        nameRu: p.nameRu,
        nameUz: p.nameUz ?? null,
        summaryRu: p.summaryRu ?? null,
        complaintsTemplate: p.complaintsTemplate ?? [],
        anamnesisTemplate: p.anamnesisTemplate ?? [],
        examinationTemplate: p.examinationTemplate ?? [],
        prescriptionsTemplate: p.prescriptionsTemplate ?? [],
        adviceTemplate: p.adviceTemplate ?? [],
        recommendedLabs: p.recommendedLabs ?? [],
        conclusionTemplateMd: p.conclusionTemplateMd ?? null,
        sortOrder: p.sortOrder ?? 0,
        active: true,
      },
    });
    count += 1;
  }

  console.log(`Seeded ${count} clinical protocols.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
