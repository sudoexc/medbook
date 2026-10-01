/**
 * Seeds the Drug + DrugBrand tables from the static catalog in
 * `_drug-catalog.ts`, merged with clinical enrichment in
 * `_drug-data.ts`.
 *
 * Idempotent and additive: upserts the curated Drug rows by id and adds the
 * curated brands a row does not carry yet. Nothing is deleted: drugs not in
 * the static catalog (per-clinic additions, the state register import) and
 * every brand already on a row (the register's trade names included, audit
 * G4-10) survive a reseed. Removing a brand from the source file does not
 * remove it from the database; that takes a data fix.
 *
 * Local: `npx tsx prisma/seed-drugs.ts`
 *
 * Production (the worker image carries prisma/ and the scripts it imports):
 * `docker compose exec worker npx tsx prisma/seed-drugs.ts`
 */
import "dotenv/config";
import { Prisma, PrismaClient, type DrugCategory } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { DRUGS as DRUGS_CORE } from "./_drug-catalog";
import { DRUGS_EXTRA } from "./_drug-catalog-extra";
import { DRUG_ENRICHMENT } from "./_drug-data";
import { curatedBrandsToAdd } from "../scripts/_registry-plan";

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
  // only ever added, see below.
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

    // Add, never replace (audit G4-10): the state register import hangs its
    // trade names on these same curated rows, and a wholesale delete here
    // erased ~1800 of them (search by brand, the allergy and CDS matching).
    const existing = await prisma.drugBrand.findMany({
      where: { drugId: d.id },
      select: { name: true },
    });
    const toAdd = curatedBrandsToAdd(
      existing.map((b) => b.name),
      d.brands ?? [],
    );
    if (toAdd.length > 0) {
      await prisma.drugBrand.createMany({
        data: toAdd.map((name) => ({ drugId: d.id, name })),
      });
    }
    drugCount += 1;
    brandCount += toAdd.length;
  }

  console.log(`Seeded ${drugCount} drugs, added ${brandCount} missing brand entries.`);
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
