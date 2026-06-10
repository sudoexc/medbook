/**
 * Seeds the Drug + DrugBrand tables from the static catalog in
 * `_drug-catalog.ts`, merged with clinical enrichment in
 * `_drug-data.ts`.
 *
 * Idempotent: wipes Drug rows (and brand rows by FK cascade) for the seeded
 * IDs, then inserts fresh. Drugs not present in the static catalog are left
 * alone (so per-clinic additions in production survive a reseed).
 *
 * Local: `npx tsx prisma/seed-drugs.ts`
 *
 * Production: see seed-drugs-sql.ts for raw SQL generator.
 */
import "dotenv/config";
import { Prisma, PrismaClient, type DrugCategory } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { DRUGS } from "./_drug-catalog";
import { DRUG_ENRICHMENT } from "./_drug-data";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const ids = DRUGS.map((d) => d.id);

  // Wipe existing rows for these ids (DrugBrand cascades).
  await prisma.drug.deleteMany({ where: { id: { in: ids } } });

  let drugCount = 0;
  let brandCount = 0;

  for (const d of DRUGS) {
    const enr = DRUG_ENRICHMENT[d.id] ?? {};
    const inn = enr.atcCode ? (d.intl ?? d.id) : (d.intl ?? d.id);

    // Forms shape in DB: [{ form: "TAB", strengths: ["2,5 мг", "5 мг"] }, ...]
    const forms = d.forms.map((f) => ({
      form: f.form,
      strengths: f.doses,
    }));

    await prisma.drug.create({
      data: {
        id: d.id,
        inn,
        nameRu: d.nameRu,
        nameUz: d.nameUz ?? null,
        atcCode: enr.atcCode ?? null,
        category: (enr.categoryOverride ?? d.category) as DrugCategory,
        forms,
        indications: enr.indications ?? [],
        contraindications: enr.contraindications ?? [],
        sideEffects: enr.sideEffects ?? [],
        pregnancyCat: enr.pregnancyCat ?? "UNKNOWN",
        defaultDosing: enr.defaultDosing ?? Prisma.JsonNull,
        rxOnly: enr.rxOnly ?? true,
        active: true,
        brands: d.brands?.length
          ? {
              create: d.brands.map((name) => ({ name })),
            }
          : undefined,
      },
    });
    drugCount += 1;
    brandCount += d.brands?.length ?? 0;
  }

  console.log(`Seeded ${drugCount} drugs with ${brandCount} brand entries.`);
  const enrichmentMissing = DRUGS.filter((d) => !DRUG_ENRICHMENT[d.id]).map((d) => d.id);
  if (enrichmentMissing.length) {
    console.log(
      `⚠ Missing clinical enrichment for ${enrichmentMissing.length} drug(s): ${enrichmentMissing.join(", ")}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
