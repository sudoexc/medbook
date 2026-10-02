/**
 * Audit G4-21 data fix: merge the catalog extension's copies of curated
 * drugs into the curated rows (see `_drug-duplicates.ts`).
 *
 * For each copy (levodopa-carbidopa, colecalciferol, magnesium-b6,
 * potassium-magnesium-asparaginate), in one transaction:
 *   1. its brand rows move to the curated row, or go where the curated row
 *      already has the brand (the register's trade names an import hung on
 *      the copy among them);
 *   2. visit prescriptions, the clinics' core-list entries, doctors'
 *      favourites, clinic overlays and saved protocol drafts that point at
 *      the copy point at the curated row (where a clinic or a doctor already
 *      has the curated row, the copy's entry folds into it);
 *   3. the copy is deactivated, never deleted: old references stay valid,
 *      and search, the CDS and the shortlist read active rows only.
 * A printed prescription keeps the name it was signed under (`displayName`),
 * only its catalog link moves, to the same substance.
 *
 * Then Сорбифер Дурулес moves from «Железа сульфат» (Тардиферон, which
 * stays) to iron_sorbifer, with the prescriptions written under that brand.
 *
 * The seed no longer lists the copies, so a reseed does not bring them back
 * to life (it used to set active: true on every run). Run the seed first:
 * it adds the copies' brands and forms to the curated rows.
 *
 * Dry run (default, reads only and prints the counts):
 *   docker compose exec -T worker npx tsx scripts/fix-g4-21-duplicate-drugs.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-g4-21-duplicate-drugs.ts
 *
 * Idempotent: a merged copy has nothing left pointing at it, and a second
 * run only reports zeros.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import {
  DUPLICATE_DRUGS,
  MISFILED_BRANDS,
  mergeFormularyAliases,
  planBrandMerge,
  repointDrafts,
} from "./_drug-duplicates";
import { normName } from "./_registry-plan";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

type Tx = Prisma.TransactionClient;

/**
 * Merge one copy into its curated row. With `apply` false it only reads and
 * counts what an apply would do (the dry run writes nothing, not even inside
 * a rolled-back transaction).
 */
async function mergeCopy(tx: Tx, from: string, to: string, apply: boolean) {
  const [fromBrands, toBrands] = await Promise.all([
    tx.drugBrand.findMany({ where: { drugId: from }, select: { id: true, name: true } }),
    tx.drugBrand.findMany({ where: { drugId: to }, select: { name: true } }),
  ]);
  const brands = planBrandMerge(fromBrands, toBrands);
  if (apply && brands.move.length > 0) {
    await tx.drugBrand.updateMany({ where: { id: { in: brands.move } }, data: { drugId: to } });
  }
  if (apply && brands.drop.length > 0) {
    await tx.drugBrand.deleteMany({ where: { id: { in: brands.drop } } });
  }

  const prescriptions = apply
    ? (await tx.visitPrescription.updateMany({ where: { drugId: from }, data: { drugId: to } })).count
    : await tx.visitPrescription.count({ where: { drugId: from } });

  // Core list: unique per (clinic, drug).
  const entries = await tx.clinicFormularyDrug.findMany({ where: { drugId: from } });
  for (const entry of apply ? entries : []) {
    const keep = await tx.clinicFormularyDrug.findUnique({
      where: { clinicId_drugId: { clinicId: entry.clinicId, drugId: to } },
    });
    if (keep) {
      const aliases = mergeFormularyAliases(keep, entry);
      await tx.clinicFormularyDrug.update({
        where: { id: keep.id },
        data: {
          aliases,
          strengths: [...new Set([...keep.strengths, ...entry.strengths])],
          // As formularySearchText (src/server/catalog/formulary.ts) builds it.
          searchText: [keep.label, ...aliases]
            .join(" | ")
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/\s+/g, " ")
            .trim(),
        },
      });
      await tx.clinicFormularyDrug.delete({ where: { id: entry.id } });
    } else {
      await tx.clinicFormularyDrug.update({ where: { id: entry.id }, data: { drugId: to } });
    }
  }

  // Favourites: unique per (user, type, code).
  const favorites = await tx.doctorFavorite.findMany({
    where: { entityType: "DRUG", entityCode: from },
  });
  for (const fav of apply ? favorites : []) {
    const has = await tx.doctorFavorite.findFirst({
      where: { userId: fav.userId, entityType: "DRUG", entityCode: to },
      select: { id: true },
    });
    if (has) await tx.doctorFavorite.delete({ where: { id: fav.id } });
    else await tx.doctorFavorite.update({ where: { id: fav.id }, data: { entityCode: to } });
  }

  // Overlays (a clinic's photo or rename): moved unless the clinic already
  // overlays the curated row, whose overlay then wins and the copy's stays
  // on the retired row.
  let overlays = 0;
  let overlaysKept = 0;
  for (const ov of await tx.clinicCatalogOverlay.findMany({
    where: { entityType: "DRUG", entityCode: from },
  })) {
    const has = await tx.clinicCatalogOverlay.findFirst({
      where: { clinicId: ov.clinicId, entityType: "DRUG", entityCode: to },
      select: { id: true },
    });
    if (has) {
      overlaysKept += 1;
      continue;
    }
    if (apply) {
      await tx.clinicCatalogOverlay.update({ where: { id: ov.id }, data: { entityCode: to } });
    }
    overlays += 1;
  }

  let protocols = 0;
  for (const p of await tx.clinicalProtocol.findMany({
    where: { prescriptionItems: { not: Prisma.DbNull } },
    select: { id: true, prescriptionItems: true },
  })) {
    const next = repointDrafts(p.prescriptionItems, from, to);
    if (!next) continue;
    if (apply) {
      await tx.clinicalProtocol.update({
        where: { id: p.id },
        data: { prescriptionItems: next as Prisma.InputJsonValue },
      });
    }
    protocols += 1;
  }

  // The seed files no pair on a copy; a pair someone added stays reported.
  const pairs = await tx.drugInteraction.count({
    where: { OR: [{ drugAId: from }, { drugBId: from }] },
  });
  const deactivated = apply
    ? (await tx.drug.updateMany({ where: { id: from, active: true }, data: { active: false } })).count
    : await tx.drug.count({ where: { id: from, active: true } });

  return {
    brandsMoved: brands.move.length,
    brandsDropped: brands.drop.length,
    prescriptions,
    formulary: entries.length,
    favorites: favorites.length,
    overlays,
    overlaysKept,
    protocols,
    pairs,
    deactivated,
  };
}

/** Move a misfiled brand and the prescriptions written under it. */
async function moveBrand(tx: Tx, brand: string, from: string, to: string, apply: boolean) {
  const key = normName(brand);
  const [onFrom, onTo] = await Promise.all([
    tx.drugBrand.findMany({ where: { drugId: from }, select: { id: true, name: true } }),
    tx.drugBrand.findMany({ where: { drugId: to }, select: { name: true } }),
  ]);
  const rows = onFrom.filter((b) => normName(b.name) === key);
  const plan = planBrandMerge(rows, onTo);
  // A prescription signed under the brand («Сорбифер Дурулес 100 мг») is
  // that product: its catalog link follows the brand.
  const written = await tx.visitPrescription.findMany({
    where: { drugId: from },
    select: { id: true, displayName: true },
  });
  const ids = written
    .filter((p) => normName(p.displayName).startsWith(key))
    .map((p) => p.id);
  if (apply) {
    if (plan.move.length > 0) {
      await tx.drugBrand.updateMany({ where: { id: { in: plan.move } }, data: { drugId: to } });
    }
    if (plan.drop.length > 0) {
      await tx.drugBrand.deleteMany({ where: { id: { in: plan.drop } } });
    }
    if (ids.length > 0) {
      await tx.visitPrescription.updateMany({ where: { id: { in: ids } }, data: { drugId: to } });
    }
  }
  return { brandRows: rows.length, prescriptions: ids.length };
}

/** Each merge in one transaction when applying; plain reads on a dry run. */
function run<T>(fn: (tx: Tx, apply: boolean) => Promise<T>): Promise<T> {
  return APPLY
    ? prisma.$transaction((tx) => fn(tx, true), { timeout: 60_000 })
    : fn(prisma, false);
}

async function main() {
  const ids = [
    ...DUPLICATE_DRUGS.flatMap((d) => [d.from, d.to]),
    ...MISFILED_BRANDS.flatMap((b) => [b.from, b.to]),
  ];
  const rows = await prisma.drug.findMany({
    where: { id: { in: ids } },
    select: { id: true, nameRu: true, active: true, clinicId: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  let work = 0;
  for (const { from, to } of DUPLICATE_DRUGS) {
    const copy = byId.get(from);
    const home = byId.get(to);
    if (!copy || !home || copy.clinicId !== null || home.clinicId !== null) {
      const why = !copy ? "no copy row" : !home ? "no curated row" : "not a global row";
      console.log(`[g4-21] ${from} → ${to}: ${why}, skipped`);
      continue;
    }
    const r = await run((tx, apply) => mergeCopy(tx, from, to, apply));
    console.log(
      `[g4-21] «${copy.nameRu}» (${from}) → «${home.nameRu}» (${to}): ` +
        `brands moved ${r.brandsMoved}, dropped ${r.brandsDropped}; ` +
        `prescriptions ${r.prescriptions}; core list ${r.formulary}; favourites ${r.favorites}; ` +
        `overlays ${r.overlays} (left on the copy: ${r.overlaysKept}); protocols ${r.protocols}; ` +
        `interaction pairs on the copy ${r.pairs}; to deactivate ${r.deactivated}`,
    );
    work +=
      r.brandsMoved + r.brandsDropped + r.prescriptions + r.formulary +
      r.favorites + r.overlays + r.protocols + r.deactivated;
  }

  for (const { brand, from, to } of MISFILED_BRANDS) {
    if (!byId.get(from) || !byId.get(to)) {
      console.log(`[g4-21] «${brand}»: ${from} or ${to} missing, skipped`);
      continue;
    }
    const r = await run((tx, apply) => moveBrand(tx, brand, from, to, apply));
    console.log(
      `[g4-21] «${brand}» ${from} → ${to}: brand rows ${r.brandRows}, prescriptions ${r.prescriptions}`,
    );
    work += r.brandRows + r.prescriptions;
  }

  if (work === 0) console.log("[g4-21] nothing to do");
  else if (!APPLY) console.log("[g4-21] DRY RUN: nothing written; run again with APPLY=1");
  else console.log("[g4-21] done");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
