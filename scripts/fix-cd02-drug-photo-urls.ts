/**
 * Audit CD-02 data fix: drug pack photos saved as a bare bucket URL.
 *
 * The photo upload stored `${MINIO_PUBLIC_URL}/<bucket>/drugs/<clinic>/…`.
 * The bucket is private, so every pack photo rendered as a broken image (in
 * search, on the prescription rows, in the handout). New uploads now store
 * our streaming proxy URL (`/api/crm/documents/file?key=…`, clinic-scoped);
 * this script rewrites the photos saved before, in both places they live:
 *   - `Drug.photoUrl` of clinic-owned drugs;
 *   - the `photoUrl` override in a clinic's ClinicCatalogOverlay for a
 *     global catalog drug.
 * Only URLs pointing at our own storage are touched; a dev `/uploads/…` path
 * or an external URL is left as is.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-cd02-drug-photo-urls.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-cd02-drug-photo-urls.ts
 *
 * Idempotent: a proxy URL maps to itself and is skipped.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { staffFileHref } from "../src/lib/storage-ref";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

/** The proxy form of a stored photo URL, or null when it needs no change. */
function rewritten(url: string | null | undefined): string | null {
  if (!url) return null;
  const next = staffFileHref(url);
  return next !== url ? next : null;
}

async function main() {
  const drugs = await prisma.drug.findMany({
    where: { photoUrl: { not: null } },
    select: { id: true, nameRu: true, photoUrl: true },
  });
  const drugFixes = drugs
    .map((d) => ({ ...d, next: rewritten(d.photoUrl) }))
    .filter((d): d is typeof d & { next: string } => d.next !== null);

  const overlays = await prisma.clinicCatalogOverlay.findMany({
    where: { entityType: "DRUG" },
    select: { id: true, clinicId: true, entityCode: true, overridesJson: true },
  });
  const overlayFixes = overlays
    .map((o) => {
      const json =
        o.overridesJson && typeof o.overridesJson === "object" && !Array.isArray(o.overridesJson)
          ? (o.overridesJson as Record<string, unknown>)
          : null;
      const photo = typeof json?.photoUrl === "string" ? json.photoUrl : null;
      const next = rewritten(photo);
      return next && json ? { ...o, json, next } : null;
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${drugFixes.length} clinic drugs, ${overlayFixes.length} catalog overlays with a bare bucket photo URL`,
  );
  for (const d of drugFixes) console.log(`  drug ${d.id} ${d.nameRu}`);
  for (const o of overlayFixes) {
    console.log(`  overlay ${o.id} clinic ${o.clinicId} drug ${o.entityCode}`);
  }

  if (!APPLY) {
    console.log("└─ nothing written; run again with APPLY=1");
    await prisma.$disconnect();
    return;
  }

  for (const d of drugFixes) {
    await prisma.drug.update({ where: { id: d.id }, data: { photoUrl: d.next } });
  }
  for (const o of overlayFixes) {
    await prisma.clinicCatalogOverlay.update({
      where: { id: o.id },
      data: {
        overridesJson: { ...o.json, photoUrl: o.next } as Prisma.InputJsonValue,
      },
    });
  }
  console.log(
    `└─ rewritten: ${drugFixes.length} drugs, ${overlayFixes.length} overlays`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
