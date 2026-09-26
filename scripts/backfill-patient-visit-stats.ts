/**
 * Backfill for `Patient.lastVisitAt` / `Patient.visitsCount` /
 * `Patient.lastContactedAt`.
 *
 * Both visit columns are read by the dormant-patient detector, the NEW/ACTIVE
 * segments, `derivePatientTags` and campaign audiences — but nothing wrote
 * them until `refreshPatientVisitStats` was added to the completion paths.
 * Existing patients therefore look like first-timers with no visit history.
 * This walks every patient with at least one COMPLETED appointment and sets
 * the columns from the appointments themselves.
 *
 * Re-run after the audit AP-07 / PT-06 fix is deployed. Until then:
 *   - visits closed from reception (`queue-status`, `bulk-status`) never
 *     refreshed the stats or moved `lastContactedAt`, and the doctor's later
 *     signature skipped them too;
 *   - `lastVisitAt` took the first row of `ORDER BY completedAt DESC`, where
 *     Postgres puts NULLs first, so one legacy completed row without
 *     `completedAt` pinned «Последний визит» to its old slot.
 * The rule here is the one `refreshPatientVisitStats` now applies:
 * lastVisitAt = MAX(COALESCE(completedAt, date)) over COMPLETED rows.
 * `lastContactedAt` only moves forward, to lastVisitAt when that is later.
 *
 * Idempotent (pure recompute, monotonic contact stamp). DRY RUN by default;
 * APPLY=1 writes.
 *
 * Prod:  docker compose run --rm -e APPLY=1 worker npx tsx scripts/backfill-patient-visit-stats.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.env.APPLY === "1";

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}

async function main() {
  // Group once instead of per-patient queries: a few thousand rows at most.
  const [grouped, legacy] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["patientId"],
      where: { status: "COMPLETED" },
      _count: { _all: true },
      // `completedAt` is when the visit ended; `date` is the booked slot and
      // can sit in the future for a visit seen early.
      _max: { completedAt: true },
    }),
    // Rows completed before `completedAt` was populated: their slot is the
    // only time we have.
    prisma.appointment.groupBy({
      by: ["patientId"],
      where: { status: "COMPLETED", completedAt: null },
      _max: { date: true },
    }),
  ]);
  const legacySlot = new Map(legacy.map((g) => [g.patientId, g._max.date]));

  console.log(`[visit-stats] patients with completed visits: ${grouped.length}`);

  let changed = 0;
  let unchanged = 0;
  let contactBumped = 0;
  for (const g of grouped) {
    const patient = await prisma.patient.findUnique({
      where: { id: g.patientId },
      select: {
        id: true,
        visitsCount: true,
        lastVisitAt: true,
        lastContactedAt: true,
      },
    });
    if (!patient) continue;

    const nextCount = g._count._all;
    const nextLast = later(
      g._max.completedAt ?? null,
      legacySlot.get(g.patientId) ?? null,
    );
    const bumpContact =
      nextLast !== null &&
      (patient.lastContactedAt === null || patient.lastContactedAt < nextLast);
    const same =
      patient.visitsCount === nextCount &&
      (patient.lastVisitAt?.getTime() ?? null) === (nextLast?.getTime() ?? null);
    if (same && !bumpContact) {
      unchanged += 1;
      continue;
    }
    if (!same) changed += 1;
    if (bumpContact) contactBumped += 1;
    if (APPLY) {
      await prisma.patient.update({
        where: { id: patient.id },
        data: {
          visitsCount: nextCount,
          lastVisitAt: nextLast,
          ...(bumpContact ? { lastContactedAt: nextLast } : {}),
        },
      });
    }
  }

  console.log(
    `[visit-stats] visit stats to update: ${changed}, last contact to move forward: ${contactBumped}, already correct: ${unchanged}`,
  );
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
