/**
 * Clears all generated demo domain data for the neurofax clinic, returning it
 * to the "fresh clinic shell" state: doctors, services, cabinets, users,
 * schedules and notification templates are preserved; every patient-derived
 * row (appointments, payments, conversations, documents, leads, audit, …) is
 * deleted. Scoped strictly by clinicId — only tables that actually have a
 * clinicId column are touched.
 *
 * This is the WIPE phase of seed-mega-neurofax.ts, extracted to run on its own
 * with NO re-seed. Irreversible.
 *
 * Production neurofax is the real clinic: _destructive-guard.ts refuses this
 * script under NODE_ENV=production with no override, and the worker image
 * does not ship it (Dockerfile.worker). It refuses a database with real data
 * too (it would delete patients, visits and signed conclusions).
 * Local database only:
 *   npx tsx scripts/wipe-neurofax-demo.ts --force
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertSeedAllowed } from "./_destructive-guard";
import { wipeClinicDemoData } from "./_demo-wipe";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

async function main() {
  await assertSeedAllowed(prisma, {
    script: "wipe-neurofax-demo",
    clinicSlug: "neurofax",
    destructive: true,
    // Hard-wired to slug neurofax, which in production is the real clinic:
    // there is no demo clinic this script could ever target on the server.
    devOnly: true,
  });
  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("clinic 'neurofax' not found");
  const clinicId = clinic.id;
  console.log(`┌─ WIPE neurofax demo (clinic ${clinicId})`);

  // One transaction, checked against the live foreign keys first, and the
  // counter set from the patients left (audit G2-09, `_demo-wipe.ts`).
  const { deleted, patientCounter } = await wipeClinicDemoData(prisma, clinicId);
  console.log(`  patientCounter → ${patientCounter}`);
  console.log(`└─ wipe done — ${deleted} rows deleted, reference data kept\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ wipe failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
