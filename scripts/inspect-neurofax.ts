/**
 * Read-only snapshot of neurofax: doctors, services, cabinets, schedules,
 * receptionists, today's appointment count. Used to plan the e2e stress test.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

async function main() {
  const clinic = await prisma.clinic.findFirst({
    where: { slug: "neurofax" },
    select: { id: true, slug: true, nameRu: true, timezone: true },
  });
  if (!clinic) {
    console.error("neurofax clinic not found");
    process.exit(1);
  }
  console.log("Clinic:", clinic);

  const [doctors, services, cabinets, patients, schedules, todayAppts, recept] =
    await Promise.all([
      prisma.doctor.findMany({
        where: { clinicId: clinic.id, isActive: true },
        select: {
          id: true,
          nameRu: true,
          specializationRu: true,
          userId: true,
        },
        take: 30,
      }),
      prisma.service.findMany({
        where: { clinicId: clinic.id, isActive: true },
        select: {
          id: true,
          nameRu: true,
          priceBase: true,
          durationMin: true,
        },
        take: 50,
      }),
      prisma.cabinet.findMany({
        where: { clinicId: clinic.id, isActive: true },
        select: { id: true, number: true, nameRu: true, floor: true },
        take: 20,
      }),
      prisma.patient.count({ where: { clinicId: clinic.id } }),
      prisma.doctorSchedule.findMany({
        where: { clinicId: clinic.id, isActive: true },
        select: {
          doctorId: true,
          weekday: true,
          startTime: true,
          endTime: true,
        },
      }),
      prisma.appointment.count({
        where: {
          clinicId: clinic.id,
          date: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lt: new Date(new Date().setHours(24, 0, 0, 0)),
          },
        },
      }),
      prisma.user.findMany({
        where: { clinicId: clinic.id, active: true },
        select: { id: true, email: true, name: true, role: true },
        take: 30,
      }),
    ]);

  console.log("\n=== Doctors active:", doctors.length, "===");
  for (const d of doctors)
    console.log("  -", d.id, "|", d.nameRu, "|", d.specializationRu);

  console.log("\n=== Services active:", services.length, "===");
  for (const s of services.slice(0, 20))
    console.log(
      "  -",
      s.id,
      "|",
      s.nameRu,
      "|",
      s.priceBase,
      "|",
      s.durationMin,
      "min",
    );

  console.log("\n=== Cabinets:", cabinets.length, "===");
  for (const c of cabinets)
    console.log("  -", c.id, "|", "№", c.number, "|", c.nameRu, "| floor", c.floor);

  console.log("\n=== Schedule coverage ===");
  const byDoc = new Map<string, Set<number>>();
  for (const s of schedules) {
    if (!byDoc.has(s.doctorId)) byDoc.set(s.doctorId, new Set());
    byDoc.get(s.doctorId)!.add(s.weekday);
  }
  for (const d of doctors) {
    const days = byDoc.get(d.id);
    console.log(
      "  -",
      d.nameRu,
      ":",
      days ? Array.from(days).sort().join(",") : "(no schedule)",
    );
  }

  console.log("\n=== Patients in clinic:", patients, "===");
  console.log("=== Today's appointment count:", todayAppts, "===");

  console.log("\n=== Receptionists ===");
  for (const r of recept) console.log("  -", r.email, "|", r.name);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
