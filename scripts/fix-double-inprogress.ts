/**
 * One-off cleanup for the neurofax demo: a doctor must have at most one visit
 * IN_PROGRESS at a time, but `seed-today-live.ts` assigned the status per-row
 * independently, so some doctors ended up with two "Идёт приём" badges in the
 * schedule. This collapses each doctor's today IN_PROGRESS set to a single
 * active visit — the latest-by-start stays IN_PROGRESS, the earlier ones flip
 * to COMPLETED (the realistic outcome: the doctor finished them first) and get
 * a PAID payment if they don't already have one.
 *
 * Idempotent: doctors already at ≤1 IN_PROGRESS are untouched.
 *
 * Run from the worker container:
 *   docker compose exec -T worker npx tsx scripts/fix-double-inprogress.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(arr: readonly T[]): T => arr[rand(arr.length)]!;

async function main() {
  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("clinic 'neurofax' not found");
  const clinicId = clinic.id;

  const now = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setUTCHours(23, 59, 59, 999);

  const active = await prisma.appointment.findMany({
    where: {
      clinicId,
      status: "IN_PROGRESS",
      date: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { date: "asc" },
  });

  // Group by doctor; keep the latest-by-date as the active visit.
  const byDoctor = new Map<string, typeof active>();
  for (const a of active) {
    const list = byDoctor.get(a.doctorId) ?? [];
    list.push(a);
    byDoctor.set(a.doctorId, list);
  }

  let demoted = 0, paid = 0, doctorsFixed = 0;
  for (const [, list] of byDoctor) {
    if (list.length <= 1) continue;
    doctorsFixed++;
    // list is date-asc; the last one stays IN_PROGRESS, the rest complete.
    const toComplete = list.slice(0, -1);
    for (const a of toComplete) {
      await prisma.appointment.update({
        where: { id: a.id },
        data: {
          status: "COMPLETED",
          queueStatus: "COMPLETED",
          completedAt: new Date(a.endDate.getTime()),
          arrivedAt: a.arrivedAt ?? new Date(a.date.getTime() - 10 * 60_000),
        },
      });
      demoted++;
      const has = await prisma.payment.count({ where: { appointmentId: a.id } });
      if (has === 0) {
        await prisma.payment.create({
          data: {
            clinicId,
            appointmentId: a.id,
            patientId: a.patientId,
            currency: "UZS",
            amount: a.priceFinal ?? a.priceBase ?? 0,
            method: pick(["CASH", "CARD", "PAYME", "CLICK", "TRANSFER"] as const),
            status: "PAID",
            paidAt: new Date(a.endDate.getTime()),
          },
        });
        paid++;
      }
    }
  }

  console.log(
    `✓ fixed ${doctorsFixed} doctor(s) with double IN_PROGRESS — ` +
    `demoted ${demoted} to COMPLETED (paid +${paid}). ` +
    `Each doctor now has at most one active visit.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ fix-double-inprogress failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
