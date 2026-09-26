/**
 * Refresh ONLY today's demo live queue to the current moment, without touching
 * past/future days or re-running the full mega seed. Deletes today's DEMO
 * appointments (the ones carrying the demo mark, child rows first) and
 * rebuilds a correct live queue via the shared builder: two-lanes ordering
 * (live FIFO ⊥ schedule), immutable ticketSeq, queuedAt anchor, a «срочно»
 * bump and a late-arrival demotion, for every doctor the board actually shows
 * today (active schedule for today's Tashkent weekday).
 *
 * Audit G2-03: it used to delete EVERY appointment of the day and deal real
 * patients into the fake queue. Now it deletes only demo-marked appointments
 * and takes only demo patients (tag `demo-seed`, see seed-prod-demo.ts). And
 * production neurofax is the real clinic: _destructive-guard.ts refuses to run
 * there unless ALLOW_DEMO_SEED_ON_REAL_DATA names the clinic, which on the
 * real clinic nobody should ever do.
 *
 * Local or demo database:
 *   npx tsx scripts/seed-today-live.ts --force
 * Env: CLINIC_SLUG (default "neurofax").
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DEMO_SEED_MARK } from "../src/lib/demo-seed";
import { assertSeedAllowed } from "./_destructive-guard";
import {
  clearTodayAppointments,
  seedTodayLiveQueue,
  todayScheduledDoctors,
} from "./_live-queue-seed";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const SLUG = process.env.CLINIC_SLUG?.trim() || "neurofax";

async function main() {
  const { clinicId } = await assertSeedAllowed(prisma, {
    script: "seed-today-live",
    clinicSlug: SLUG,
    destructive: true,
  });
  const now = new Date();

  const doctors = await todayScheduledDoctors(prisma, clinicId, now);
  if (doctors.length === 0) {
    console.log(
      "no doctors scheduled for today's weekday — the board is empty by design, nothing to animate.",
    );
    await prisma.$disconnect();
    return;
  }

  const services = await prisma.service.findMany({
    where: { clinicId, isActive: true },
    select: { id: true, durationMin: true, priceBase: true },
  });
  // Demo patients only: a real patient must never get a made-up visit.
  const patients = await prisma.patient.findMany({
    where: { clinicId, tags: { has: DEMO_SEED_MARK }, deletedAt: null },
    select: { id: true },
    take: 2000,
  });
  if (services.length === 0) throw new Error("the clinic has no active services");
  if (patients.length === 0) {
    throw new Error(
      `no demo patients (tag «${DEMO_SEED_MARK}»): create them first with APPLY=1 npx tsx scripts/seed-prod-demo.ts`,
    );
  }
  const operator = await prisma.user.findFirst({
    where: { clinicId, role: { in: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] } },
    select: { id: true },
  });

  console.log(`▶ refreshing today's live queue (clinic ${clinicId}, ${doctors.length} doctors)\n`);

  const removed = await clearTodayAppointments(prisma, clinicId, now);
  const live = await seedTodayLiveQueue(prisma, {
    clinicId,
    doctors,
    services,
    patients,
    operatorId: operator?.id ?? null,
    now,
  });

  console.log(
    `✓ today live queue refreshed:\n` +
      `   removed ${removed} old demo rows · created ${live.created} new across ` +
      `${doctors.length} doctors (+${live.payments} payments)`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ today-live failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
