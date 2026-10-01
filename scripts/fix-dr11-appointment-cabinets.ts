/**
 * Audit DR-11 data fix: visits still ahead that point at a cabinet their
 * doctor no longer occupies.
 *
 * Moving a doctor to another cabinet («Сменить кабинет») used to change only
 * `Doctor.cabinetId`; the `cabinetId` snapshot on his booked visits stayed on
 * the old room. Reminders, the reception queue, the ticket and the TV board
 * read that snapshot, so patients were sent to the old room, and the doctor
 * who took the old room over got false «кабинет занят» conflicts. The PATCH
 * now moves the remaining visits in the same transaction
 * (`src/server/doctors/cabinet-move.ts`); this script realigns the rows left
 * behind by moves made before that, with the same selection: from the start
 * of today (Tashkent), not finished, cancelled or no-show, with a cabinet set
 * that differs from the doctor's current one.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-dr11-appointment-cabinets.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-dr11-appointment-cabinets.ts
 *
 * Idempotent: a visit already in its doctor's cabinet is not selected. Each
 * doctor is moved in its own transaction; when a visit in the new room
 * overlaps one of his (the cabinet EXCLUDE constraint refuses it), that
 * doctor is skipped and reported, nothing of his is half-moved.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { cabinetMoveWhere } from "../src/server/doctors/cabinet-move";
import { isSlotOverlapViolation } from "../src/server/appointments/overlap-violation";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

async function main() {
  const now = new Date();
  const doctors = await prisma.doctor.findMany({
    select: {
      id: true,
      clinicId: true,
      nameRu: true,
      cabinetId: true,
      cabinet: { select: { number: true } },
    },
    orderBy: [{ clinicId: "asc" }, { nameRu: "asc" }],
  });

  const plan: Array<{
    doctorId: string;
    clinicId: string;
    name: string;
    cabinetId: string;
    cabinet: string;
    count: number;
  }> = [];
  for (const d of doctors) {
    const count = await prisma.appointment.count({
      where: cabinetMoveWhere(d.id, d.cabinetId, now),
    });
    if (count > 0) {
      plan.push({
        doctorId: d.id,
        clinicId: d.clinicId,
        name: d.nameRu,
        cabinetId: d.cabinetId,
        cabinet: d.cabinet.number,
        count,
      });
    }
  }

  const total = plan.reduce((a, p) => a + p.count, 0);
  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${total} visits of ${plan.length} doctors point at a cabinet the doctor left`,
  );
  for (const p of plan) {
    console.log(
      `  clinic ${p.clinicId} doctor ${p.doctorId} ${p.name}: ${p.count} visits → cabinet ${p.cabinet}`,
    );
  }

  if (!APPLY) {
    console.log("└─ nothing written; run again with APPLY=1");
    await prisma.$disconnect();
    return;
  }

  let moved = 0;
  const skipped: string[] = [];
  for (const p of plan) {
    try {
      const res = await prisma.$transaction((tx) =>
        tx.appointment.updateMany({
          where: cabinetMoveWhere(p.doctorId, p.cabinetId, now),
          data: { cabinetId: p.cabinetId },
        }),
      );
      moved += res.count;
    } catch (e) {
      if (!isSlotOverlapViolation(e)) throw e;
      skipped.push(`${p.doctorId} ${p.name}`);
    }
  }
  console.log(`└─ moved: ${moved} visits`);
  if (skipped.length > 0) {
    console.log(
      `   skipped (a visit already sits in the new room at the same time, reschedule by hand): ${skipped.join("; ")}`,
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
