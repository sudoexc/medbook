/**
 * Standalone dev-only seed for Phase 20 Wave 5a (Reminder + LabResult).
 *
 * Why a separate file: `prisma/seed.ts` has a Prisma-7 strict-mode bug at
 * the upstream `doctor.upsert` call (clinic relation isn't connected) that
 * is out of scope for this phase. This script reads existing clinics +
 * doctor users + patients from the local DB and only adds reminders +
 * labs, so dev surfaces have something to render while the full seed
 * remains broken.
 *
 *   npx tsx scripts/seed-labs-reminders-dev.ts
 *
 * Idempotent — skips a doctor if they already have reminders/labs.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

async function main() {
  const now = new Date();

  const reminderTitles = [
    "Перезвонить пациенту по результатам",
    "Заказать повторный ОАК",
    "Уточнить дозу препарата у фармацевта",
    "Подготовить выписку",
    "Проверить рецепт",
  ];
  const labCatalog = [
    { testName: "Глюкоза крови", unit: "ммоль/л", refRange: "3.3-5.5", values: [{ v: "5.1", f: "NORMAL" as const }, { v: "6.4", f: "HIGH" as const }, { v: "3.0", f: "LOW" as const }] },
    { testName: "Гемоглобин", unit: "г/л", refRange: "120-160", values: [{ v: "135", f: "NORMAL" as const }, { v: "108", f: "LOW" as const }] },
    { testName: "Холестерин общий", unit: "ммоль/л", refRange: "3.0-5.2", values: [{ v: "4.5", f: "NORMAL" as const }, { v: "7.8", f: "HIGH" as const }, { v: "9.2", f: "CRITICAL" as const }] },
    { testName: "ТТГ", unit: "мЕд/л", refRange: "0.4-4.0", values: [{ v: "2.1", f: "NORMAL" as const }, { v: "5.8", f: "HIGH" as const }] },
    { testName: "СОЭ", unit: "мм/ч", refRange: "2-15", values: [{ v: "8", f: "NORMAL" as const }, { v: "32", f: "HIGH" as const }] },
  ];

  const clinics = await prisma.clinic.findMany({ select: { id: true, slug: true } });
  for (const clinic of clinics) {
    const doctors = await prisma.user.findMany({
      where: { clinicId: clinic.id, role: "DOCTOR" },
      select: { id: true, name: true },
    });
    const patients = await prisma.patient.findMany({
      where: { clinicId: clinic.id },
      select: { id: true },
      take: 50,
    });
    if (doctors.length === 0 || patients.length === 0) continue;

    for (const d of doctors) {
      const remCount = await prisma.reminder.count({ where: { clinicId: clinic.id, doctorId: d.id } });
      if (remCount === 0) {
        for (let i = 0; i < 3; i++) {
          await prisma.reminder.create({
            data: {
              clinicId: clinic.id,
              doctorId: d.id,
              patientId: i === 0 ? null : pick(patients).id,
              title: pick(reminderTitles),
              remindAt: new Date(now.getTime() + Math.random() * 22 * 3_600_000),
              status: "PENDING",
            },
          });
        }
      }

      const labCount = await prisma.labResult.count({ where: { clinicId: clinic.id, doctorId: d.id } });
      if (labCount === 0) {
        const total = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < total; i++) {
          const test = pick(labCatalog);
          const v = pick(test.values);
          await prisma.labResult.create({
            data: {
              clinicId: clinic.id,
              doctorId: d.id,
              patientId: pick(patients).id,
              testName: test.testName,
              value: v.v,
              unit: test.unit,
              refRange: test.refRange,
              flag: v.f,
              status: "RESULTED",
              receivedAt: new Date(now.getTime() - Math.random() * 14 * 24 * 3_600_000),
            },
          });
        }
      }
      console.log(`  [${clinic.slug}] ${d.name}: reminders=${remCount}->${await prisma.reminder.count({ where: { clinicId: clinic.id, doctorId: d.id } })}, labs=${labCount}->${await prisma.labResult.count({ where: { clinicId: clinic.id, doctorId: d.id } })}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
