/**
 * Idempotent demo-data seed for prod neurofax clinic.
 *
 *   - Upserts all 11 NotificationTemplate keys (with proper RU/UZ bodies).
 *   - Adds 30 demo patients in the +998999100XXXX phone range (so they're easy
 *     to spot vs. real ones). Idempotent via clinicId_phoneNormalized unique.
 *   - For each demo patient with no appointments yet, creates 1 past
 *     COMPLETED + 1 future BOOKED appointment using existing real
 *     doctors / services / cabinets / default branch. Past appts also get a
 *     PAID Payment row.
 *
 * What it does NOT touch:
 *   - Existing real users (doctors, admin, super, receptionist).
 *   - Existing real Doctor / Service / Cabinet / Branch rows.
 *   - The `demo-clinic` clinic — never created on prod.
 *   - The `1@1.uz` dev shortcut user — never created on prod.
 *
 * Run:
 *   docker compose exec worker npx tsx scripts/seed-prod-demo.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}
function atHour(d: Date, h: number, m = 0): Date {
  const r = new Date(d);
  r.setHours(h, m, 0, 0);
  return r;
}

const FIRST_NAMES = [
  "Азиза", "Иван", "Феруза", "Мухаммад", "Ойбек", "Сардор", "Камила", "Бобур",
  "Нигора", "Алишер", "Мадина", "Улугбек", "Гулнора", "Фарход", "Дилшод",
];
const LAST_NAMES = [
  "Каримов", "Усманов", "Юлдашев", "Хасанов", "Турсунов", "Махмудов", "Рахимов",
];

const TEMPLATES = [
  {
    key: "reminder.24h",
    nameRu: "Напоминание за 24 часа",
    nameUz: "24 soat oldin eslatma",
    category: "REMINDER" as const,
    trigger: "APPOINTMENT_BEFORE" as const,
    triggerConfig: { offsetMin: -1440 },
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! Напоминаем: завтра в {{appointment.time}} у вас приём — {{appointment.doctor}}. Адрес: {{clinic.address}}. Тел: {{clinic.phone}}.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! Eslatma: ertaga soat {{appointment.time}} da qabulga yoziluvingiz bor — {{appointment.doctor}}. Manzil: {{clinic.address}}. Tel: {{clinic.phone}}.",
    variables: [
      "patient.firstName", "appointment.time", "appointment.doctor",
      "clinic.address", "clinic.phone",
    ],
  },
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
      "patient.firstName", "appointment.time", "appointment.doctor",
      "clinic.address", "clinic.phone",
    ],
  },
  {
    key: "reminder.2h",
    nameRu: "Напоминание за 2 часа",
    nameUz: "2 soat oldin eslatma",
    category: "REMINDER" as const,
    trigger: "APPOINTMENT_BEFORE" as const,
    triggerConfig: { offsetMin: -120 },
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! Через 2 часа у вас приём — {{appointment.doctor}}. Адрес: {{clinic.address}}.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! 2 soat ichida qabulga yoziluvingiz bor — {{appointment.doctor}}. Manzil: {{clinic.address}}.",
    variables: ["patient.firstName", "appointment.doctor", "clinic.address"],
  },
  {
    key: "reminder.confirm",
    nameRu: "Подтверждение записи",
    nameUz: "Yozuv tasdiqlash",
    category: "REMINDER" as const,
    trigger: "APPOINTMENT_CREATED" as const,
    triggerConfig: null,
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! Вы записаны на {{appointment.date}} в {{appointment.time}} к врачу {{appointment.doctor}}. Адрес: {{clinic.address}}.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! Siz {{appointment.date}} kuni soat {{appointment.time}} da {{appointment.doctor}} qabuliga yozildingiz. Manzil: {{clinic.address}}.",
    variables: [
      "patient.firstName", "appointment.date", "appointment.time",
      "appointment.doctor", "clinic.address",
    ],
  },
  {
    key: "reminder.missed",
    nameRu: "Не пришли на приём",
    nameUz: "Qabulga kelmadingiz",
    category: "REMINDER" as const,
    trigger: "APPOINTMENT_MISSED" as const,
    triggerConfig: { offsetMin: 30 },
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! Сегодня вы не пришли на приём в {{clinic.name}}. Перезаписаться: {{clinic.phone}}.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! Bugun {{clinic.name}}dagi qabulga kelmadingiz. Qayta yozilish: {{clinic.phone}}.",
    variables: ["patient.firstName", "clinic.name", "clinic.phone"],
  },
  {
    key: "reminder.feedback",
    nameRu: "Оставьте отзыв",
    nameUz: "Fikr qoldiring",
    category: "REMINDER" as const,
    trigger: "APPOINTMENT_COMPLETED" as const,
    triggerConfig: { offsetMin: 60 },
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! Спасибо за визит в {{clinic.name}}. Будем благодарны за отзыв.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! {{clinic.name}}ga tashrif uchun rahmat. Fikringizdan minnatdor bo'lamiz.",
    variables: ["patient.firstName", "clinic.name"],
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
      "patient.firstName", "case.daysLeft", "case.deadline",
      "clinic.name", "clinic.phone",
    ],
  },
  {
    key: "marketing.birthday",
    nameRu: "С днём рождения",
    nameUz: "Tug'ilgan kuningiz bilan",
    category: "MARKETING" as const,
    trigger: "PATIENT_BIRTHDAY" as const,
    triggerConfig: null,
    bodyRu:
      "С днём рождения, {{patient.firstName}}! {{clinic.name}} желает вам крепкого здоровья. В подарок — скидка 10% на любой приём в течение месяца.",
    bodyUz:
      "Tug'ilgan kuningiz muborak, {{patient.firstName}}! {{clinic.name}} sizga sog'liq tilaydi. Bir oy davomida har qanday qabulga 10% chegirma — sovg'a sifatida.",
    variables: ["patient.firstName", "clinic.name"],
  },
  {
    key: "marketing.dormant",
    nameRu: "Давно не были",
    nameUz: "Uzoqdan ko'rinmadingiz",
    category: "MARKETING" as const,
    trigger: "PATIENT_INACTIVE_DAYS" as const,
    triggerConfig: { days: 180 },
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! Вы давно не были в {{clinic.name}}. Запишитесь на приём: {{clinic.phone}}.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! Siz {{clinic.name}}da uzoq vaqt bo'lmadingiz. Qabulga yoziling: {{clinic.phone}}.",
    variables: ["patient.firstName", "clinic.name", "clinic.phone"],
  },
  {
    key: "marketing.promo",
    nameRu: "Акция месяца",
    nameUz: "Oy aksiyasi",
    category: "MARKETING" as const,
    trigger: "MANUAL" as const,
    triggerConfig: null,
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! В {{clinic.name}} специальное предложение этого месяца. Подробности: {{clinic.phone}}.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! {{clinic.name}}da bu oyning maxsus taklifi. Batafsil: {{clinic.phone}}.",
    variables: ["patient.firstName", "clinic.name", "clinic.phone"],
  },
  {
    key: "transactional.payment",
    nameRu: "Чек об оплате",
    nameUz: "To'lov cheki",
    category: "TRANSACTIONAL" as const,
    trigger: "MANUAL" as const,
    triggerConfig: null,
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! Ваш чек по оплате услуг в {{clinic.name}} готов.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! {{clinic.name}}dagi xizmatlar uchun chekingiz tayyor.",
    variables: ["patient.firstName", "clinic.name"],
  },
  {
    key: "transactional.document",
    nameRu: "Готов ваш документ",
    nameUz: "Hujjatingiz tayyor",
    category: "TRANSACTIONAL" as const,
    trigger: "MANUAL" as const,
    triggerConfig: null,
    bodyRu:
      "Здравствуйте, {{patient.firstName}}! Ваш документ готов и доступен в личном кабинете.",
    bodyUz:
      "Assalomu alaykum, {{patient.firstName}}! Hujjatingiz tayyor va shaxsiy kabinetda mavjud.",
    variables: ["patient.firstName"],
  },
];

async function main() {
  console.log("Seeding prod demo data for neurofax (idempotent)…\n");

  const clinic = await prisma.clinic.findUnique({
    where: { slug: "neurofax" },
  });
  if (!clinic) throw new Error("[seed] neurofax clinic not found");
  console.log(`✔ clinic: ${clinic.slug} (${clinic.id})`);

  // ── Phase 1: NotificationTemplates ──────────────────────────────────────
  let tplCreated = 0;
  let tplRefreshed = 0;
  for (const t of TEMPLATES) {
    const existing = await prisma.notificationTemplate.findUnique({
      where: { clinicId_key: { clinicId: clinic.id, key: t.key } },
      select: { id: true },
    });
    await prisma.notificationTemplate.upsert({
      where: { clinicId_key: { clinicId: clinic.id, key: t.key } },
      update: {
        nameRu: t.nameRu,
        nameUz: t.nameUz,
        category: t.category,
        trigger: t.trigger,
        triggerConfig: t.triggerConfig as any,
        bodyRu: t.bodyRu,
        bodyUz: t.bodyUz,
        variables: t.variables,
        isActive: true,
      },
      create: {
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
    if (existing) tplRefreshed++;
    else tplCreated++;
  }
  console.log(`✔ templates: +${tplCreated} created, ${tplRefreshed} refreshed\n`);

  // ── Phase 2: Demo patients + appointments ───────────────────────────────
  // Branch is optional on prod — existing 448 appts have branchId=null, so
  // we follow the same pattern. If a default branch happens to exist, use it.
  const branch = await prisma.branch.findFirst({
    where: { clinicId: clinic.id, isDefault: true, isActive: true },
  });

  const doctors = await prisma.doctor.findMany({
    where: { clinicId: clinic.id, isActive: true },
  });
  const services = await prisma.service.findMany({
    where: { clinicId: clinic.id, isActive: true },
  });
  const cabinets = await prisma.cabinet.findMany({
    where: { clinicId: clinic.id, isActive: true },
  });
  if (doctors.length === 0 || services.length === 0 || cabinets.length === 0) {
    throw new Error(
      `[seed] need doctors/services/cabinets — got ${doctors.length}/${services.length}/${cabinets.length}`,
    );
  }
  console.log(
    `  found ${doctors.length} doctors / ${services.length} services / ${cabinets.length} cabinets`,
  );

  const DEMO_COUNT = 540;
  let patientsNew = 0;
  let apptsNew = 0;
  let paymentsNew = 0;
  const now = new Date();

  for (let i = 0; i < DEMO_COUNT; i++) {
    const phone = `99910${String(i).padStart(4, "0")}`; // 9 digits: 99910 + 0000..0029
    const phoneNormalized = `+998${phone}`;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);

    let patient = await prisma.patient.findUnique({
      where: {
        clinicId_phoneNormalized: { clinicId: clinic.id, phoneNormalized },
      },
    });
    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          clinicId: clinic.id,
          fullName: `${last} ${first}`,
          phone,
          phoneNormalized,
          gender: i % 2 === 0 ? "MALE" : "FEMALE",
          segment: pick(["NEW", "ACTIVE", "DORMANT", "VIP"] as const),
          preferredChannel: "TG",
          preferredLang: "RU",
          consentMarketing: true,
        },
      });
      patientsNew++;
    }

    // Idempotent per-kind: each demo patient should end up with ≥1 past
    // COMPLETED + ≥1 future BOOKED. Re-runs backfill whichever side is missing.
    const [existingPast, existingFuture] = await Promise.all([
      prisma.appointment.count({
        where: { clinicId: clinic.id, patientId: patient.id, date: { lt: now } },
      }),
      prisma.appointment.count({
        where: { clinicId: clinic.id, patientId: patient.id, date: { gte: now } },
      }),
    ]);

    const targets: Array<{
      kind: "past" | "future";
      status: "COMPLETED" | "BOOKED";
    }> = [];
    if (existingPast === 0)
      targets.push({ kind: "past", status: "COMPLETED" });
    if (existingFuture === 0)
      targets.push({ kind: "future", status: "BOOKED" });
    if (targets.length === 0) continue;

    for (const target of targets) {
      const MAX_RETRIES = 12;
      let placed = false;
      for (let attempt = 0; attempt < MAX_RETRIES && !placed; attempt++) {
        const doctor = pick(doctors);
        const cabinet = pick(cabinets);
        const service = pick(services);
        // Past: -30..-1 days; Future: 0..+7 days (today included, denser dashboards).
        // Past hour 9..17, future hour biased to current/upcoming hours of today.
        const dayOffset =
          target.kind === "past"
            ? -1 - Math.floor(Math.random() * 30)
            : Math.floor(Math.random() * 8);
        const hour = 9 + Math.floor(Math.random() * 9);
        const minute = pick([0, 15, 30, 45]);
        const date = atHour(addDays(now, dayOffset), hour, minute);
        const duration = service.durationMin;
        const endDate = new Date(date.getTime() + duration * 60_000);
        const slot = { status: target.status };
        try {
        const appt = await prisma.appointment.create({
          data: {
            clinicId: clinic.id,
            branchId: branch?.id ?? null,
            patientId: patient.id,
            doctorId: doctor.id,
            cabinetId: cabinet.id,
            serviceId: service.id,
            date,
            durationMin: duration,
            endDate,
            status: slot.status,
            queueStatus: slot.status,
            channel: pick(["WALKIN", "PHONE", "TELEGRAM", "WEBSITE"] as const),
            priceService: service.priceBase,
            priceBase: service.priceBase,
            priceFinal: service.priceBase,
            completedAt:
              slot.status === "COMPLETED" ? new Date(endDate.getTime()) : null,
          },
        });
        apptsNew++;
        await prisma.appointmentService.create({
          data: {
            clinicId: clinic.id,
            appointmentId: appt.id,
            serviceId: service.id,
            priceSnap: service.priceBase,
            quantity: 1,
          },
        });
        if (slot.status === "COMPLETED") {
          await prisma.payment.create({
            data: {
              clinicId: clinic.id,
              appointmentId: appt.id,
              patientId: patient.id,
              currency: "UZS",
              amount: service.priceBase,
              method: pick(["CASH", "CARD", "PAYME", "CLICK"] as const),
              status: "PAID",
              paidAt: new Date(endDate.getTime()),
            },
          });
          paymentsNew++;
        }
        placed = true;
        } catch (e: any) {
          // Slot collision (Appointment_doctor_no_overlap) — try a different
          // random slot. Log only on final failure.
          if (attempt === MAX_RETRIES - 1) {
            console.warn(
              `  [skip ${target.kind}] patient=${patient.id}: ${e.message}`,
            );
          }
        }
      }
    }
  }

  console.log(`✔ patients: +${patientsNew}`);
  console.log(`✔ appointments: +${apptsNew}`);
  console.log(`✔ payments: +${paymentsNew}`);

  await prisma.$disconnect();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
