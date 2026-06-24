/**
 * Live-board polish for the neurofax demo: makes TODAY look like a clinic
 * mid-shift right now. The mega seed places today's appointments at fixed
 * hours that, once rendered in the clinic timezone (Asia/Tashkent, +5),
 * land entirely in the future — so the board shows only BOOKED.
 *
 * This script (today's rows only):
 *   1. Shifts every today appointment by a uniform −6h so they straddle "now"
 *      across the clinic's working hours. A uniform shift preserves the
 *      per-doctor non-overlap arrangement, so no exclusion-constraint clashes.
 *   2. Re-statuses by time band vs now: earlier → COMPLETED (+ PAID payment) /
 *      a few NO_SHOW / CANCELLED, around now → IN_PROGRESS / WAITING (queue),
 *      later → BOOKED.
 *
 * Idempotent guard: aborts if today already has an IN_PROGRESS appt.
 *
 * Run from worker container:
 *   docker compose exec -T worker npx tsx scripts/seed-today-live.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(arr: readonly T[]): T => arr[rand(arr.length)]!;
const SHIFT_MS = 6 * 60 * 60 * 1000;

async function main() {
  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("clinic 'neurofax' not found");
  const clinicId = clinic.id;
  const now = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setUTCHours(23, 59, 59, 999);

  const todays = await prisma.appointment.findMany({
    where: { clinicId, date: { gte: dayStart, lte: dayEnd } },
    orderBy: { date: "asc" },
  });
  if (todays.length === 0) throw new Error("no appointments today to animate");
  if (todays.some((a) => a.status === "IN_PROGRESS")) {
    console.log("today already has IN_PROGRESS — looks live already, aborting.");
    await prisma.$disconnect();
    return;
  }
  console.log(`▶ animating ${todays.length} today appointments (clinic ${clinicId})\n`);

  // 1. Uniform −6h shift (overlap-safe).
  for (const a of todays) {
    await prisma.appointment.update({
      where: { id: a.id },
      data: {
        date: new Date(a.date.getTime() - SHIFT_MS),
        endDate: new Date(a.endDate.getTime() - SHIFT_MS),
      },
    });
  }

  const shifted = await prisma.appointment.findMany({
    where: { clinicId, date: { gte: dayStart, lte: dayEnd } },
    orderBy: { date: "asc" },
  });

  let completed = 0, inProgress = 0, waiting = 0, booked = 0, noShow = 0,
    cancelled = 0, paid = 0;
  let queueOrder = 1;
  // A doctor can only see one patient at a time. The band logic below assigns
  // IN_PROGRESS per-row, so back-to-back near-now slots for the same doctor
  // could both go active — track who's already busy and queue the rest.
  const doctorActive = new Set<string>();

  for (const a of shifted) {
    const mins = (a.date.getTime() - now.getTime()) / 60_000;
    let status:
      | "COMPLETED" | "NO_SHOW" | "CANCELLED" | "IN_PROGRESS" | "WAITING"
      | "BOOKED";
    if (mins < -45) {
      const r = Math.random();
      status = r < 0.84 ? "COMPLETED" : r < 0.93 ? "NO_SHOW" : "CANCELLED";
    } else if (mins < 15) {
      status = Math.random() < 0.6 ? "IN_PROGRESS" : "WAITING";
    } else if (mins < 75) {
      status = Math.random() < 0.45 ? "WAITING" : "BOOKED";
    } else {
      status = "BOOKED";
    }

    // One active visit per doctor: if this doctor is already mid-приём, queue
    // the rest as WAITING instead of a second simultaneous IN_PROGRESS.
    if (status === "IN_PROGRESS") {
      if (doctorActive.has(a.doctorId)) status = "WAITING";
      else doctorActive.add(a.doctorId);
    }

    const data: any = { status, queueStatus: status };
    const endMs = a.endDate.getTime();
    if (status === "COMPLETED") {
      data.completedAt = new Date(endMs);
      data.arrivedAt = new Date(a.date.getTime() - 10 * 60_000);
    } else if (status === "IN_PROGRESS") {
      data.arrivedAt = new Date(a.date.getTime() - (15 + rand(20)) * 60_000);
      data.startedAt = new Date(now.getTime() - rand(20) * 60_000);
      data.queueOrder = queueOrder++;
      data.completedAt = null;
    } else if (status === "WAITING") {
      data.arrivedAt = new Date(now.getTime() - rand(40) * 60_000);
      data.queueOrder = queueOrder++;
      data.completedAt = null;
    } else if (status === "CANCELLED") {
      data.cancelledAt = new Date(a.date.getTime() - (30 + rand(180)) * 60_000);
      data.cancelledBy = pick(["patient", "staff", "no-show"]);
      data.completedAt = null;
    } else {
      data.completedAt = null;
    }

    await prisma.appointment.update({ where: { id: a.id }, data });

    if (status === "COMPLETED") {
      completed++;
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
            paidAt: new Date(endMs),
          },
        });
        paid++;
      }
    } else if (status === "IN_PROGRESS") inProgress++;
    else if (status === "WAITING") waiting++;
    else if (status === "NO_SHOW") noShow++;
    else if (status === "CANCELLED") cancelled++;
    else booked++;
  }

  console.log(
    `✓ today live board:\n` +
    `   completed=${completed} (paid +${paid}) · inProgress=${inProgress} · ` +
    `waiting=${waiting} · booked=${booked} · noShow=${noShow} · cancelled=${cancelled}`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ today-live failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
