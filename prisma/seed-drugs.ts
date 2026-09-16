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

import { DRUGS as DRUGS_CORE } from "./_drug-catalog";
import { DRUGS_EXTRA } from "./_drug-catalog-extra";
import { DRUG_ENRICHMENT } from "./_drug-data";

/**
 * Curated core plus the depth extension, kept in separate files on purpose:
 * the originals were compiled against local practice, while the extension was
 * assembled without an official registry and still wants a pharmacist's eye.
 * Splitting them keeps that distinction visible in review.
 */
const DRUGS = [...DRUGS_CORE, ...DRUGS_EXTRA];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const ids = DRUGS.map((d) => d.id);

  // Upsert rather than wipe-and-recreate. Deleting was safe while this was a
  // fresh-install seed, but the clinic is live now and VisitPrescription rows
  // point at these ids — dropping a drug either fails on the foreign key or
  // silently detaches a prescription from its catalog entry. Brands are
  // replaced per drug instead, since they are pure catalog data with nothing
  // referencing them.
  void ids;

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

    const fields = {
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
    };

    await prisma.drug.upsert({
      where: { id: d.id },
      create: { id: d.id, ...fields },
      update: fields,
    });

    // Brands are catalog-only (nothing references them), so replacing them
    // wholesale keeps the list in step with the source file.
    await prisma.drugBrand.deleteMany({ where: { drugId: d.id } });
    if (d.brands?.length) {
      await prisma.drugBrand.createMany({
        data: d.brands.map((name) => ({ drugId: d.id, name })),
      });
    }
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
