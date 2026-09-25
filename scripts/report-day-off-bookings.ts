/**
 * Audit AP-01 follow-up (read-only): upcoming bookings that fall on a
 * doctor's day off or outside the doctor's working hours.
 *
 * Before the fix a weekday without schedule rows fell back to 09:00–19:00, so
 * the Mini App and the CRM happily booked a Mon–Fri doctor on Sunday. New
 * bookings are now refused; the ones already made are still in the book, and
 * those patients will come to a closed cabinet unless reception calls them.
 * This lists them, using the same rule the booking engine now applies
 * (`workingWindowsFor`). A doctor with no schedule at all is never listed.
 *
 * Writes nothing, so there is no APPLY mode:
 *   docker compose exec -T worker npx tsx scripts/report-day-off-bookings.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { tashkentComponents } from "../src/lib/booking-validation";
import { workingWindowsFor } from "../src/lib/doctor-working-windows";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

async function main() {
  const now = new Date();
  const [appts, schedules] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        date: { gt: now },
        status: { in: ["BOOKED", "CONFIRMED"] },
        channel: { not: "WALKIN" },
      },
      select: {
        id: true,
        date: true,
        endDate: true,
        channel: true,
        doctorId: true,
        doctor: { select: { nameRu: true } },
        patient: { select: { fullName: true, phone: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.doctorSchedule.findMany({
      where: { isActive: true },
      select: {
        doctorId: true,
        weekday: true,
        startTime: true,
        endTime: true,
        validFrom: true,
        validTo: true,
      },
    }),
  ]);

  const byDoctor = new Map<string, typeof schedules>();
  for (const s of schedules) {
    const list = byDoctor.get(s.doctorId) ?? [];
    list.push(s);
    byDoctor.set(s.doctorId, list);
  }

  const hits = appts.filter((a) => {
    const rows = byDoctor.get(a.doctorId) ?? [];
    if (rows.length === 0) return false; // no schedule: legacy open day
    const start = tashkentComponents(a.date);
    const end = tashkentComponents(a.endDate);
    const endMin = end.date === start.date ? end.minutes : 24 * 60;
    return !workingWindowsFor(rows, start.date).some(
      (w) => start.minutes >= minutes(w.start) && endMin <= minutes(w.end),
    );
  });

  console.log(`Upcoming bookings outside the doctor's schedule: ${hits.length}`);
  for (const a of hits) {
    const c = tashkentComponents(a.date);
    console.log(
      `  ${c.date} ${c.time}  ${a.doctor.nameRu}  ${a.patient.fullName}  ${a.patient.phone}  (${a.channel}, ${a.id})`,
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
