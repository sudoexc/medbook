/**
 * Audit AN-17 data fix: `Patient.dormantSince` stamps that outlived the lapse.
 *
 * Reactivation stamps `dormantSince` when it writes to a lapsed patient, and
 * nothing ever cleared it: a patient who came back kept the stamp for good.
 * `refreshPatientVisitStats` now clears it on the first completed visit on
 * or after the stamp; this clears the ones left from before. (The loss
 * dashboard no longer reads the stamp at all, it goes by `lastVisitAt`.)
 *
 * What it changes: patients whose `lastVisitAt` is on or after their
 * `dormantSince` get `dormantSince = null`. Nothing else; patients still
 * lapsed keep their stamp.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-an17-stale-dormant-since.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-an17-stale-dormant-since.ts
 *
 * Idempotent: a second run finds nothing, and each write only lands while
 * the stamp is still on or before the patient's last visit.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

async function main() {
  const stamped = await prisma.patient.findMany({
    where: { dormantSince: { not: null }, lastVisitAt: { not: null } },
    select: { id: true, clinicId: true, dormantSince: true, lastVisitAt: true },
  });
  const stale = stamped.filter(
    (p) => p.dormantSince && p.lastVisitAt && p.lastVisitAt >= p.dormantSince,
  );

  const byClinic = new Map<string, number>();
  for (const p of stale) byClinic.set(p.clinicId, (byClinic.get(p.clinicId) ?? 0) + 1);
  console.log(`[an17] patients with dormantSince: ${stamped.length}`);
  console.log(`[an17] came back after the stamp (to clear): ${stale.length}`);
  for (const [clinicId, n] of byClinic) console.log(`[an17]   clinic ${clinicId}: ${n}`);

  if (!APPLY) {
    console.log("[an17] DRY RUN. Set APPLY=1 to write.");
    return;
  }

  let cleared = 0;
  for (const p of stale) {
    const res = await prisma.patient.updateMany({
      where: { id: p.id, dormantSince: { lte: p.lastVisitAt! } },
      data: { dormantSince: null },
    });
    cleared += res.count;
  }
  console.log(`[an17] cleared: ${cleared}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
