/**
 * Refresh ONLY today's live queue to the current moment — without touching
 * past/future days or re-running the full mega seed. Deletes today's
 * appointments (child rows first) and rebuilds a correct live queue via the
 * shared builder: two-lanes ordering (live FIFO ⊥ schedule), immutable ticketSeq, queuedAt anchor,
 * a «срочно» bump and a late-arrival demotion, for every doctor the board
 * actually shows today (active schedule for today's Tashkent weekday).
 *
 * Use it to make the TV board look mid-shift right now for a demo, or to
 * re-roll the queue between viewings. Idempotent — safe to run repeatedly.
 *
 * Run from worker container:
 *   docker compose exec -T worker npx tsx scripts/seed-today-live.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  clearTodayAppointments,
  seedTodayLiveQueue,
  todayScheduledDoctors,
} from "./_live-queue-seed";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

async function main() {
  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("clinic 'neurofax' not found");
  const clinicId = clinic.id;
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
  const patients = await prisma.patient.findMany({
    where: { clinicId },
    select: { id: true },
    take: 2000,
  });
  if (services.length === 0 || patients.length === 0) {
    throw new Error(`need services + patients — got ${services.length}/${patients.length}`);
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
      `   removed ${removed} old rows · created ${live.created} new across ` +
      `${doctors.length} doctors (+${live.payments} payments)`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ today-live failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
