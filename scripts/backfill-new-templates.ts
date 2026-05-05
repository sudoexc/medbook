import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const NEW_TEMPLATES = [
  {
    key: "reminder.5h",
    nameRu: "Напоминание за 5 часов",
    nameUz: "5 soat oldin eslatma",
    category: "REMINDER" as const,
    trigger: "APPOINTMENT_BEFORE" as const,
    triggerConfig: { offsetMin: -300 },
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! Напоминаем: сегодня в {{appointment.time}} у вас приём — {{appointment.doctor}}. Адрес: {{clinic.address}}. Тел: {{clinic.phone}}.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! Eslatma: bugun soat {{appointment.time}} da qabulga yoziluvingiz bor — {{appointment.doctor}}. Manzil: {{clinic.address}}. Tel: {{clinic.phone}}.",
    variables: [
      "patient.firstName",
      "appointment.time",
      "appointment.doctor",
      "clinic.address",
      "clinic.phone",
    ],
  },
  {
    key: "case.repeat-due",
    nameRu: "Бесплатный повторный визит",
    nameUz: "Bepul takroriy qabul",
    category: "REMINDER" as const,
    trigger: "CASE_REPEAT_DUE" as const,
    triggerConfig: { daysBefore: 2 },
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! У вас осталось {{case.daysLeft}} дн. на бесплатный повторный приём в {{clinic.name}}. Запишитесь до {{case.deadline}}. Тел: {{clinic.phone}}.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! {{clinic.name}}da bepul takroriy qabulga {{case.daysLeft}} kun qoldi. {{case.deadline}} gacha yozilib oling. Tel: {{clinic.phone}}.",
    variables: [
      "patient.firstName",
      "case.daysLeft",
      "case.deadline",
      "clinic.name",
      "clinic.phone",
    ],
  },
];

async function main() {
  const clinics = await prisma.clinic.findMany({
    select: { id: true, slug: true, nameRu: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${clinics.length} clinic(s)`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const clinic of clinics) {
    for (const t of NEW_TEMPLATES) {
      const existing = await prisma.notificationTemplate.findUnique({
        where: { clinicId_key: { clinicId: clinic.id, key: t.key } },
        select: { id: true },
      });

      if (existing) {
        skippedCount++;
        console.log(`  [skip] ${clinic.slug} :: ${t.key} (already exists)`);
        continue;
      }

      await prisma.notificationTemplate.create({
        data: {
          clinicId: clinic.id,
          key: t.key,
          nameRu: t.nameRu,
          nameUz: t.nameUz,
          channel: "TG",
          category: t.category,
          trigger: t.trigger,
          triggerConfig: t.triggerConfig as any,
          bodyRu: t.bodyRu,
          bodyUz: t.bodyUz,
          variables: t.variables,
          isActive: true,
        },
      });
      createdCount++;
      console.log(`  [+]    ${clinic.slug} :: ${t.key}`);
    }
  }

  console.log(`\nDone. Created: ${createdCount}, skipped: ${skippedCount}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
