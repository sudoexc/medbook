/**
 * Audit G1-13: document files in storage that no row points at.
 *
 * An upload stores the bytes first and the document row second. When the
 * second step never lands (session expired, tab closed, network lost) the
 * file stays in the bucket where no list shows it and no DSAR erasure finds
 * it. The dialogs take such uploads back when they can; this report is the
 * backstop. It lists every object under `clinics/<clinic>/documents/` that
 * is older than a day and that no stored URL names (documents, doctor
 * signatures and their snapshots on e-prescriptions and sick leaves, photos,
 * receipts, chat attachments: see src/server/documents/orphan-files.ts).
 *
 * Dry run (default, deletes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-g1-13-orphan-document-files.ts
 * Apply (deletes the listed objects):
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-g1-13-orphan-document-files.ts
 *
 * Idempotent: a deleted object is not listed again. Safe to re-run, e.g.
 * weekly; an upload younger than a day is never touched.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { deleteObject, listObjects } from "../src/server/storage/minio";
import {
  DOCUMENT_OBJECTS_PREFIX,
  findOrphanDocumentObjects,
  loadDocumentFileReferences,
} from "../src/server/documents/orphan-files";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const now = new Date();
  // Storage first, rows second: a row created in between can only make an
  // object referenced, never the other way round.
  const objects = await listObjects(undefined, DOCUMENT_OBJECTS_PREFIX);
  const references = await loadDocumentFileReferences(prisma);
  const orphans = findOrphanDocumentObjects({ objects, references, now });

  const bytes = orphans.reduce((sum, o) => sum + (o.size ?? 0), 0);
  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${orphans.length} orphan document files (${(bytes / 1024 / 1024).toFixed(1)} MB) of ${objects.length} objects under ${DOCUMENT_OBJECTS_PREFIX}`,
  );
  for (const o of orphans) {
    const ageDays = o.lastModified
      ? Math.floor((now.getTime() - o.lastModified.getTime()) / DAY_MS)
      : "?";
    console.log(`  ${o.key}  ${o.size ?? "?"} B  ${ageDays} d`);
  }

  if (!APPLY) {
    console.log("└─ nothing deleted; run again with APPLY=1");
    await prisma.$disconnect();
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const o of orphans) {
    try {
      await deleteObject(undefined, o.key);
      deleted += 1;
    } catch (e) {
      failed += 1;
      console.error(`  failed ${o.key}:`, e);
    }
  }
  console.log(`└─ deleted: ${deleted}, failed: ${failed}`);
  await prisma.$disconnect();
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
