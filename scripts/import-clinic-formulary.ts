/**
 * Load a clinic's core drug list (ClinicFormularyDrug) from a seed file.
 *
 *   - entries linked to a catalog row are checked to exist and be active;
 *   - entries without one become the clinic's own Drug rows (found again by
 *     name on re-runs, never duplicated);
 *   - «без рецепта» on a global row is recorded as the clinic's overlay
 *     (`rxOnly: false`), leaving the shared catalog untouched;
 *   - list entries no longer in the seed are removed (the seed is the list).
 *
 * Idempotent. DRY RUN by default; APPLY=1 writes.
 *
 * Prod:
 *   docker compose run --rm -e APPLY=1 -v /opt/neurofax/scripts:/app/scripts \
 *     worker npx tsx scripts/import-clinic-formulary.ts
 * Env: CLINIC_SLUG (default neurofax).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { NEUROFAX_FORMULARY, type FormularySeed } from "./data/formulary-neurofax";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.env.APPLY === "1";
const CLINIC_SLUG = process.env.CLINIC_SLUG ?? "neurofax";

const SEEDS: Record<string, FormularySeed[]> = { neurofax: NEUROFAX_FORMULARY };

// Keep in step with src/server/catalog/formulary.ts.
function norm(raw: string): string {
  return raw.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

async function main() {
  const seed = SEEDS[CLINIC_SLUG];
  if (!seed) throw new Error(`no formulary seed for clinic «${CLINIC_SLUG}»`);
  const clinic = await prisma.clinic.findUnique({
    where: { slug: CLINIC_SLUG },
    select: { id: true },
  });
  if (!clinic) throw new Error(`clinic «${CLINIC_SLUG}» not found`);
  const admin = await prisma.user.findFirst({
    where: { clinicId: clinic.id, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  console.log(`[formulary] ${CLINIC_SLUG}: ${seed.length} entries, ${APPLY ? "APPLY" : "dry run"}`);

  const keepDrugIds: string[] = [];
  let linked = 0;
  let created = 0;
  let reused = 0;
  let overlays = 0;
  const problems: string[] = [];

  for (const [i, e] of seed.entries()) {
    let drugId = e.drugId;

    if (drugId) {
      const row = await prisma.drug.findUnique({
        where: { id: drugId },
        select: { id: true, active: true, clinicId: true, rxOnly: true },
      });
      if (!row || !row.active || (row.clinicId && row.clinicId !== clinic.id)) {
        problems.push(`${e.label}: catalog row «${drugId}» missing/inactive — skipped`);
        continue;
      }
      linked += 1;
      // «без рецепта» on a shared row → this clinic's overlay only.
      if (e.otc && row.rxOnly && row.clinicId === null) {
        overlays += 1;
        if (APPLY) {
          const existing = await prisma.clinicCatalogOverlay.findUnique({
            where: {
              clinicId_entityType_entityCode: {
                clinicId: clinic.id,
                entityType: "DRUG",
                entityCode: drugId,
              },
            },
          });
          const patch = {
            ...((existing?.overridesJson as Record<string, unknown> | null) ?? {}),
            rxOnly: false,
          };
          if (existing) {
            await prisma.clinicCatalogOverlay.update({
              where: { id: existing.id },
              data: { overridesJson: patch as Prisma.InputJsonValue },
            });
          } else {
            if (!admin) throw new Error("no ADMIN user to own the overlay");
            await prisma.clinicCatalogOverlay.create({
              data: {
                clinicId: clinic.id,
                entityType: "DRUG",
                entityCode: drugId,
                // An override, not a hide.
                hideGlobal: false,
                overridesJson: patch as Prisma.InputJsonValue,
                createdById: admin.id,
              },
            });
          }
        }
      }
    } else {
      const existing = await prisma.drug.findFirst({
        where: {
          clinicId: clinic.id,
          nameRu: { equals: e.label, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (existing) {
        drugId = existing.id;
        reused += 1;
      } else {
        created += 1;
        // ASCII ids, as the doctor quick-add route makes them.
        const uid = randomUUID();
        drugId = `clinic-${uid}`;
        if (APPLY) {
          await prisma.drug.create({
            data: {
              id: drugId,
              inn: `clinic:${clinic.id}:${uid}`,
              nameRu: e.label,
              category: "OTHER",
              forms: [] as Prisma.InputJsonValue,
              rxOnly: !e.otc,
              clinicId: clinic.id,
            },
          });
        }
      }
    }

    keepDrugIds.push(drugId);
    if (APPLY) {
      const data = {
        label: e.label,
        aliases: e.aliases,
        strengths: e.strengths,
        searchText: norm([e.label, ...e.aliases].join(" | ")),
        sortOrder: i,
      };
      await prisma.clinicFormularyDrug.upsert({
        where: { clinicId_drugId: { clinicId: clinic.id, drugId } },
        update: data,
        create: { clinicId: clinic.id, drugId, ...data },
      });
    }
  }

  const stale = await prisma.clinicFormularyDrug.count({
    where: { clinicId: clinic.id, drugId: { notIn: keepDrugIds } },
  });
  if (APPLY && stale > 0) {
    await prisma.clinicFormularyDrug.deleteMany({
      where: { clinicId: clinic.id, drugId: { notIn: keepDrugIds } },
    });
  }

  console.log(
    `[formulary] linked=${linked} created=${created} reused=${reused} otcOverlays=${overlays} removedStale=${stale}`,
  );
  for (const p of problems) console.warn(`[formulary] ! ${p}`);
  if (!APPLY) console.log("[formulary] dry run — nothing written (APPLY=1 to write)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
