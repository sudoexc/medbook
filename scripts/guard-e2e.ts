/**
 * End-to-end fixture for the "one active visit per doctor" guard.
 *
 *   npx tsx scripts/guard-e2e.ts setup    → builds a fresh cabinet + doctor
 *     (login: guard-e2e@neurofax.uz / Guard12345, 2FA off) with two WAITING
 *     appointments today, and prints their ids for the HTTP test.
 *   npx tsx scripts/guard-e2e.ts cleanup  → removes every artifact it created,
 *     restoring the empty-clinic shell.
 *
 * The setup is idempotent: it cleans up any prior run before recreating.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const CABINET_NO = "T-901";
const DOCTOR_SLUG = "guard-e2e";
const LOGIN_EMAIL = "guard-e2e@neurofax.uz";
const LOGIN_PASSWORD = "Guard12345";
const PATIENT_TAG = "guard-e2e";

async function getClinicId(): Promise<string> {
  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("clinic 'neurofax' not found");
  return clinic.id;
}

async function cleanup(clinicId: string) {
  const doctor = await prisma.doctor.findFirst({
    where: { clinicId, slug: DOCTOR_SLUG },
  });
  if (doctor) {
    await prisma.appointment.deleteMany({ where: { doctorId: doctor.id } });
    await prisma.doctor.delete({ where: { id: doctor.id } });
  }
  await prisma.patient.deleteMany({
    where: { clinicId, tags: { has: PATIENT_TAG } },
  });
  await prisma.user.deleteMany({ where: { email: LOGIN_EMAIL } });
  await prisma.cabinet.deleteMany({ where: { clinicId, number: CABINET_NO } });
}

async function setup(clinicId: string) {
  await cleanup(clinicId);

  const cabinet = await prisma.cabinet.create({
    data: { clinicId, number: CABINET_NO, nameRu: "Тест-кабинет", nameUz: "Test xona" },
  });

  const user = await prisma.user.create({
    data: {
      clinicId,
      email: LOGIN_EMAIL,
      name: "Guard E2E Doctor",
      role: "DOCTOR",
      passwordHash: await bcrypt.hash(LOGIN_PASSWORD, 10),
      active: true,
      mustChangePassword: false,
    },
  });

  const doctor = await prisma.doctor.create({
    data: {
      clinicId,
      cabinetId: cabinet.id,
      userId: user.id,
      slug: DOCTOR_SLUG,
      nameRu: "Тест Гард",
      nameUz: "Test Gard",
      specializationRu: "Невролог",
      specializationUz: "Nevrolog",
    },
  });

  const now = new Date();
  const mkPatient = (n: number) =>
    prisma.patient.create({
      data: {
        clinicId,
        patientNumber: 90000 + n,
        fullName: `Гард Пациент ${n}`,
        phone: `+99890111220${n}`,
        phoneNormalized: `99890111220${n}`,
        tags: [PATIENT_TAG],
      },
    });
  const p1 = await mkPatient(1);
  const p2 = await mkPatient(2);

  const mkAppt = (patientId: string, offsetMin: number) =>
    prisma.appointment.create({
      data: {
        clinicId,
        patientId,
        doctorId: doctor.id,
        cabinetId: cabinet.id,
        date: new Date(now.getTime() + offsetMin * 60_000),
        endDate: new Date(now.getTime() + (offsetMin + 30) * 60_000),
        durationMin: 30,
        status: "WAITING",
        queueStatus: "WAITING",
        arrivedAt: now,
        channel: "WALKIN",
      },
    });
  // Same doctor ⇒ same cabinet (1:1), and the cabinet has a no-overlap
  // exclusion constraint — so the two slots must be sequential, not concurrent.
  // The guard is per-doctor and IN_PROGRESS isn't time-gated, so two back-to-
  // back WAITING slots are a faithful "tried to start the next before
  // finishing the current" scenario.
  const a1 = await mkAppt(p1.id, -60);
  const a2 = await mkAppt(p2.id, -25);

  console.log("SETUP_OK");
  console.log(`DOCTOR=${doctor.id}`);
  console.log(`APPT1=${a1.id}`);
  console.log(`APPT2=${a2.id}`);
  console.log(`EMAIL=${LOGIN_EMAIL}`);
  console.log(`PASSWORD=${LOGIN_PASSWORD}`);
}

async function main() {
  const mode = process.argv[2] ?? "setup";
  const clinicId = await getClinicId();
  if (mode === "cleanup") {
    await cleanup(clinicId);
    console.log("CLEANUP_OK");
  } else {
    await setup(clinicId);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ guard-e2e failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
