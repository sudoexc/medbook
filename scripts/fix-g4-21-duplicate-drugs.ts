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
 *      has the curated row, the copy's entry folds into it). A clinic's hide
 *      is never moved: the merged card stays hidden only where the clinic
 *      hid both cards, and the dry run names each clinic whose hide changes;
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
  type DrugOverlayState,
  MISFILED_BRANDS,
  mergeFormularyAliases,
  planBrandMerge,
  planOverlayMerge,
  repointDrafts,
} from "./_drug-duplicates";
import { normName } from "./_registry-plan";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

type Tx = Prisma.TransactionClient;

type Overlay = {
  id: string;
  hideGlobal: boolean;
  overridesJson: Prisma.JsonValue;
};

function overlayState(ov: Overlay): DrugOverlayState {
  const raw = ov.overridesJson;
  const overrides =
    raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length > 0
      ? (raw as Record<string, unknown>)
      : null;
  return { hideGlobal: ov.hideGlobal, overrides };
}

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

  // Overlays (a clinic's hide, photo or rename), per clinic: see
  // planOverlayMerge. A hide is never moved onto the curated row, and a
  // curated row the clinic hid while it used the copy is shown again, so
  // every clinic that had a card of this drug keeps one. The copy's
  // overlay always leaves the copy (moved, or folded and deleted).
  const copyRow = await tx.drug.findUnique({ where: { id: from }, select: { active: true } });
  const byClinic = new Map<string, { copy?: Overlay; curated?: Overlay }>();
  for (const ov of await tx.clinicCatalogOverlay.findMany({
    where: { entityType: "DRUG", entityCode: { in: [from, to] } },
    select: { id: true, clinicId: true, entityCode: true, hideGlobal: true, overridesJson: true },
  })) {
    const slot = byClinic.get(ov.clinicId) ?? {};
    if (ov.entityCode === from) slot.copy = ov;
    else slot.curated = ov;
    byClinic.set(ov.clinicId, slot);
  }
  const overlays = { clinics: 0, overridesMoved: 0, hidesDropped: 0, hidesLifted: 0, keptHidden: 0 };
  const notes: string[] = [];
  for (const [clinicId, { copy, curated }] of byClinic) {
    const plan = planOverlayMerge(
      copy ? overlayState(copy) : null,
      curated ? overlayState(curated) : null,
      copyRow?.active ?? false,
    );
    if (!plan.changed) continue;
    overlays.clinics += 1;
    if (plan.movedOverrides) overlays.overridesMoved += 1;
    if (plan.droppedHide) overlays.hidesDropped += 1;
    if (plan.liftedHide) {
      overlays.hidesLifted += 1;
      notes.push(`clinic ${clinicId} hid «${to}» and used the copy: the hide is lifted`);
    }
    if (plan.keptHidden) {
      overlays.keptHidden += 1;
      notes.push(`clinic ${clinicId} hid both cards: «${to}» stays hidden`);
    }
    if (!apply) continue;
    const next = plan.curated && {
      hideGlobal: plan.curated.hideGlobal,
      overridesJson: plan.curated.overrides
        ? (plan.curated.overrides as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    };
    if (curated) {
      if (next) await tx.clinicCatalogOverlay.update({ where: { id: curated.id }, data: next });
      else await tx.clinicCatalogOverlay.delete({ where: { id: curated.id } });
      if (copy) await tx.clinicCatalogOverlay.delete({ where: { id: copy.id } });
    } else if (copy) {
      // The row itself moves, so its author stays on record.
      if (next) {
        await tx.clinicCatalogOverlay.update({
          where: { id: copy.id },
          data: { ...next, entityCode: to },
        });
      } else {
        await tx.clinicCatalogOverlay.delete({ where: { id: copy.id } });
      }
    }
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
    notes,
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
        `overlays of ${r.overlays.clinics} clinic(s): patches moved ${r.overlays.overridesMoved}, ` +
        `copy hides dropped ${r.overlays.hidesDropped}, curated hides lifted ${r.overlays.hidesLifted}, ` +
        `hidden on both ${r.overlays.keptHidden}; protocols ${r.protocols}; ` +
        `interaction pairs on the copy ${r.pairs}; to deactivate ${r.deactivated}`,
    );
    for (const note of r.notes) console.log(`[g4-21]   ${note}`);
    work +=
      r.brandsMoved + r.brandsDropped + r.prescriptions + r.formulary +
      r.favorites + r.overlays.clinics + r.protocols + r.deactivated;
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
