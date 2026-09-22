/**
 * One-off backfill for `Patient.lastVisitAt` / `Patient.visitsCount`.
 *
 * Both columns are read by the dormant-patient detector, the NEW/ACTIVE
 * segments, `derivePatientTags` and campaign audiences — but nothing wrote
 * them until `refreshPatientVisitStats` was added to the completion paths.
 * Existing patients therefore look like first-timers with no visit history.
 * This walks every patient with at least one COMPLETED appointment and sets
 * the two columns from the appointments themselves.
 *
 * Idempotent (pure recompute). DRY RUN by default; APPLY=1 writes.
 *
 * Prod:  docker compose run --rm -e APPLY=1 worker npx tsx scripts/backfill-patient-visit-stats.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.env.APPLY === "1";

async function main() {
  // Group once instead of per-patient queries: a few thousand rows at most.
  const grouped = await prisma.appointment.groupBy({
    by: ["patientId"],
    where: { status: "COMPLETED" },
    _count: { _all: true },
    _max: { date: true },
  });

  console.log(`[visit-stats] patients with completed visits: ${grouped.length}`);

  let changed = 0;
  let unchanged = 0;
  for (const g of grouped) {
    const patient = await prisma.patient.findUnique({
      where: { id: g.patientId },
      select: { id: true, visitsCount: true, lastVisitAt: true },
    });
    if (!patient) continue;

    const nextCount = g._count._all;
    const nextLast = g._max.date ?? null;
    const same =
      patient.visitsCount === nextCount &&
      (patient.lastVisitAt?.getTime() ?? null) === (nextLast?.getTime() ?? null);
    if (same) {
      unchanged += 1;
      continue;
    }
    changed += 1;
    if (APPLY) {
      await prisma.patient.update({
        where: { id: patient.id },
        data: { visitsCount: nextCount, lastVisitAt: nextLast },
      });
    }
  }

  console.log(`[visit-stats] to update: ${changed}, already correct: ${unchanged}`);
  if (!APPLY) {
    console.log("[visit-stats] DRY RUN — set APPLY=1 to write.");
  } else {
    console.log("[visit-stats] done.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
