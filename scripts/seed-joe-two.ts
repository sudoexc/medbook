/**
 * Seeds two back-to-back WAITING appointments today for the neurologist "joe"
 * so the single-active-visit guard can be tested by hand in the doctor cabinet:
 * start the first → IN_PROGRESS, then try to start the second → blocked with a
 * warning. Sequential slots (the doctor's cabinet has a no-overlap constraint).
 *
 *   docker compose exec -T worker npx tsx scripts/seed-joe-two.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const DOCTOR_ID = "cmq6oqd1x000407mjs6unib0l"; // joe, невролог
const TAG = "joe-guard-test";

async function main() {
  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("clinic 'neurofax' not found");
  const clinicId = clinic.id;

  const doctor = await prisma.doctor.findUnique({ where: { id: DOCTOR_ID } });
  if (!doctor || doctor.clinicId !== clinicId) {
    throw new Error("doctor 'joe' not found in neurofax");
  }

  // Clear any leftovers from a previous run of this script.
  const prior = await prisma.patient.findMany({
    where: { clinicId, tags: { has: TAG } },
    select: { id: true },
  });
  if (prior.length) {
    const ids = prior.map((p) => p.id);
    await prisma.appointment.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  }

  const base = clinic.patientCounter ?? 0;
  const mkPatient = (n: number, name: string) =>
    prisma.patient.create({
      data: {
        clinicId,
        patientNumber: base + n,
        fullName: name,
        phone: `+99890222110${n}`,
        phoneNormalized: `99890222110${n}`,
        tags: [TAG],
      },
    });
  const p1 = await mkPatient(1, "Тестов Алишер");
  const p2 = await mkPatient(2, "Каримова Дилноза");
  await prisma.clinic.update({
    where: { id: clinicId },
    data: { patientCounter: base + 2 },
  });

  const now = new Date();
  const mkAppt = (patientId: string, startOff: number, endOff: number) =>
    prisma.appointment.create({
      data: {
        clinicId,
        patientId,
        doctorId: DOCTOR_ID,
        cabinetId: doctor.cabinetId,
        date: new Date(now.getTime() + startOff * 60_000),
        endDate: new Date(now.getTime() + endOff * 60_000),
        durationMin: endOff - startOff,
        status: "WAITING",
        queueStatus: "WAITING",
        arrivedAt: now,
        channel: "WALKIN",
      },
    });
  const a1 = await mkAppt(p1.id, -20, 10);
  const a2 = await mkAppt(p2.id, 15, 45);

  console.log("✓ two WAITING appointments seeded for joe (невролог):");
  console.log(`  1) ${p1.fullName} — appt ${a1.id}`);
  console.log(`  2) ${p2.fullName} — appt ${a2.id}`);
  console.log("  → start #1, then try #2: the guard should block it.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ seed-joe-two failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
