import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  return digits.startsWith("998") ? `+${digits}` : `+998${digits}`;
}

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

// ──────────────────────────────────────────────────────────────────────────
// Seed data defs
// ──────────────────────────────────────────────────────────────────────────

interface ClinicSeed {
  slug: string;
  nameRu: string;
  nameUz: string;
  addressRu: string;
  addressUz: string;
  phone: string;
  email: string;
  brandColor: string;
}

const clinicsToSeed: ClinicSeed[] = [
  {
    slug: "neurofax",
    nameRu: "Диагностический центр NeuroFax",
    nameUz: "NeuroFax diagnostika markazi",
    addressRu: "г. Ташкент, ул. Пример, 1",
    addressUz: "Toshkent sh., Namuna ko'ch., 1",
    phone: "+998712000001",
    email: "info@neurofax.uz",
    brandColor: "#3DD5C0",
  },
  {
    slug: "demo-clinic",
    nameRu: "Демо-клиника",
    nameUz: "Demo klinika",
    addressRu: "г. Ташкент, ул. Демо, 42",
    addressUz: "Toshkent sh., Demo ko'ch., 42",
    phone: "+998712000002",
    email: "info@demo-clinic.uz",
    brandColor: "#6366F1",
  },
];

const FIRST_NAMES_RU = [
  "Азиза", "Иван", "Феруза", "Мухаммад", "Ойбек", "Сардор", "Камила", "Бобур",
  "Нигора", "Алишер", "Мадина", "Улугбек", "Гулнора", "Фарход", "Дилшод",
];
const LAST_NAMES_RU = [
  "Каримов", "Усманов", "Юлдашев", "Хасанов", "Турсунов", "Махмудов", "Рахимов",
];

// ── DoctorPreset seeds ────────────────────────────────────────────────
// Personal chip presets surfaced under each ChipFieldCard on the doctor's
// reception screen. Clicking a chip adds `fieldValue` to the structured
// field and (if `noteTemplate` is set) appends that snippet to the
// conclusion editor. Demo doctors only — production doctors manage their
// own presets at /doctor/settings?tab=presets.
type PresetSeed = {
  field: "COMPLAINTS" | "ANAMNESIS" | "EXAMINATION" | "PRESCRIPTIONS" | "ADVICE";
  label: string;
  fieldValue?: string;
  noteTemplate?: string;
};

const PRESETS_BY_SLUG: Record<string, PresetSeed[] | undefined> = {
  neurologist: [
    { field: "COMPLAINTS", label: "Головная боль",
      noteTemplate: "Жалобы на головную боль давящего характера в лобно-теменной области, периодическая, без рвоты, светобоязнь умеренная." },
    { field: "COMPLAINTS", label: "Головокружение",
      noteTemplate: "Жалобы на головокружение несистемного характера, преимущественно при перемене положения тела." },
    { field: "COMPLAINTS", label: "Бессонница",
      noteTemplate: "Жалобы на нарушение сна: трудности засыпания, поверхностный сон, частые ночные пробуждения." },
    { field: "COMPLAINTS", label: "Слабость" },
    { field: "COMPLAINTS", label: "Онемение" },

    { field: "ANAMNESIS", label: "Без особенностей",
      fieldValue: "Анамнез без особенностей",
      noteTemplate: "Из анамнеза: хронических заболеваний не выявлено, операций, травм не было, аллергоанамнез не отягощён." },
    { field: "ANAMNESIS", label: "Стресс на работе" },
    { field: "ANAMNESIS", label: "ЧМТ в анамнезе" },

    { field: "EXAMINATION", label: "В сознании, ориентирован",
      noteTemplate: "Сознание ясное, контактен, ориентирован в месте, времени и собственной личности." },
    { field: "EXAMINATION", label: "ЧМН без патологии" },
    { field: "EXAMINATION", label: "Рефлексы D=S" },

    { field: "PRESCRIPTIONS", label: "Мексидол 125 мг",
      fieldValue: "Мексидол 125 мг — по 1 таб 3 раза в день, 30 дней",
      noteTemplate: "Мексидол 125 мг — по 1 таблетке 3 раза в день внутрь, курс 30 дней. Принимать после еды." },
    { field: "PRESCRIPTIONS", label: "Глицин 100 мг",
      fieldValue: "Глицин 100 мг — по 1 таб 3 раза в день, 30 дней",
      noteTemplate: "Глицин 100 мг — рассасывать по 1 таблетке под язык 3 раза в день, 30 дней." },
    { field: "PRESCRIPTIONS", label: "Магне B6",
      fieldValue: "Магне B6 — по 2 таб 2 раза в день, 1 месяц",
      noteTemplate: "Магне B6 — по 2 таблетки 2 раза в день во время еды, курс 1 месяц." },
    { field: "PRESCRIPTIONS", label: "Грандаксин 50 мг",
      fieldValue: "Грандаксин 50 мг — по 1 таб 2 раза в день утром и днём, 14 дней",
      noteTemplate: "Грандаксин 50 мг — по 1 таблетке утром и днём, не вечером, курс 14 дней." },

    { field: "ADVICE", label: "Режим сна",
      fieldValue: "Режим сна 7–8 часов, отбой до 23:00",
      noteTemplate: "Рекомендуется соблюдать режим сна: 7–8 часов в сутки, отбой не позднее 23:00, исключить экраны за час до сна." },
    { field: "ADVICE", label: "Прогулки",
      fieldValue: "Прогулки на свежем воздухе 30–40 минут ежедневно" },
    { field: "ADVICE", label: "Контрольная явка через 2 нед",
      noteTemplate: "Контрольный осмотр через 2 недели. При ухудшении — обратиться раньше." },
  ],

  cardiologist: [
    { field: "COMPLAINTS", label: "Боль в груди",
      noteTemplate: "Жалобы на боли в области сердца, давящего характера, длительностью до 10 минут, купируются в покое." },
    { field: "COMPLAINTS", label: "Одышка",
      noteTemplate: "Жалобы на одышку при умеренной физической нагрузке (подъём на 2–3 этаж)." },
    { field: "COMPLAINTS", label: "Учащённое сердцебиение" },
    { field: "COMPLAINTS", label: "Отёки голеней" },
    { field: "COMPLAINTS", label: "Перебои в работе сердца" },

    { field: "ANAMNESIS", label: "АГ в анамнезе",
      fieldValue: "Артериальная гипертензия в анамнезе",
      noteTemplate: "Из анамнеза: артериальная гипертензия в течение нескольких лет, рабочее АД 130–140/85 мм рт. ст." },
    { field: "ANAMNESIS", label: "ИБС в анамнезе" },
    { field: "ANAMNESIS", label: "Курение",
      fieldValue: "Курит, стаж > 10 лет" },
    { field: "ANAMNESIS", label: "Семейный анамнез по ССЗ" },

    { field: "EXAMINATION", label: "Тоны сердца ясные",
      noteTemplate: "Тоны сердца ясные, ритмичные. Шумов не выслушивается." },
    { field: "EXAMINATION", label: "АД 120/80, ЧСС 72" },
    { field: "EXAMINATION", label: "Отёков нет" },

    { field: "PRESCRIPTIONS", label: "Конкор 5 мг",
      fieldValue: "Конкор 5 мг — по 1 таб утром, длительно",
      noteTemplate: "Конкор (бисопролол) 5 мг — по 1 таблетке утром, длительно. Контроль ЧСС и АД." },
    { field: "PRESCRIPTIONS", label: "Энап 10 мг",
      fieldValue: "Энап 10 мг — по 1 таб 2 раза в день",
      noteTemplate: "Энап (эналаприл) 10 мг — по 1 таблетке утром и вечером. Контроль АД." },
    { field: "PRESCRIPTIONS", label: "Кардиомагнил 75 мг",
      fieldValue: "Кардиомагнил 75 мг — по 1 таб вечером, длительно",
      noteTemplate: "Кардиомагнил 75 мг — по 1 таблетке вечером после еды, длительно." },
    { field: "PRESCRIPTIONS", label: "Аторвастатин 20 мг",
      fieldValue: "Аторвастатин 20 мг — по 1 таб вечером",
      noteTemplate: "Аторвастатин 20 мг — по 1 таблетке вечером. Через 1 месяц — контроль АЛТ, АСТ, липидограмма." },

    { field: "ADVICE", label: "Низкосолевая диета",
      fieldValue: "Низкосолевая диета (до 5 г соли в сутки)",
      noteTemplate: "Низкосолевая диета — не более 5 г соли в сутки. Ограничить копчёности, маринады, фастфуд." },
    { field: "ADVICE", label: "Дневник АД",
      fieldValue: "Вести дневник АД — утром и вечером",
      noteTemplate: "Вести дневник АД: утром (после пробуждения, до приёма таблеток) и вечером. Принести на следующий приём." },
    { field: "ADVICE", label: "Отказ от курения" },
    { field: "ADVICE", label: "Контроль через 1 мес",
      noteTemplate: "Повторный осмотр через 1 месяц с дневником АД и результатами липидограммы." },
  ],
};

const SERVICE_TEMPLATES = [
  { code: "CONSULT", nameRu: "Консультация", nameUz: "Konsultatsiya", durationMin: 30, priceBase: 200_000 * 100, category: "Консультация" },
  { code: "EEG", nameRu: "ЭЭГ", nameUz: "EEG", durationMin: 60, priceBase: 150_000 * 100, category: "Диагностика" },
  { code: "ECG", nameRu: "ЭКГ", nameUz: "EKG", durationMin: 30, priceBase: 70_000 * 100, category: "Диагностика" },
  { code: "UZI", nameRu: "УЗИ (1 орган)", nameUz: "UZI (1 organ)", durationMin: 30, priceBase: 80_000 * 100, category: "УЗИ" },
  { code: "ECHO_KG", nameRu: "ЭхоКГ", nameUz: "ExoKG", durationMin: 45, priceBase: 150_000 * 100, category: "УЗИ" },
];

const TEMPLATE_SEEDS = [
  // 7 reminders (3d / 24h / 5h / 2h cascade — Stage 2.D added the soft 3d
  // ping for TELEGRAM/WEBSITE bookings whose `confirmedAt` is still null.
  // The 24h + 2h messages now end with a "reply YES to confirm" CTA so
  // patients on SMS-only fallback can still confirm without the TG button.
  // See docs/TZ.md §6.9.)
  { key: "reminder.3d",  nameRu: "Напоминание за 3 дня",   nameUz: "3 kun oldin eslatma",   category: "REMINDER" as const, trigger: "APPOINTMENT_BEFORE" as const, triggerConfig: { offsetMin: -4320 },
    bodyRu: "Напоминаем: визит к {{appointment.doctor}} {{appointment.date}} в {{appointment.time}}. Если планы изменились — позвоните: {{clinic.phone}}.",
    bodyUz: "Eslatma: {{appointment.doctor}} qabuluvingiz {{appointment.date}} kuni soat {{appointment.time}} da. Rejalar o'zgargan bo'lsa qo'ng'iroq qiling: {{clinic.phone}}." },
  { key: "reminder.24h", nameRu: "Напоминание за 24 часа", nameUz: "24 soat oldin eslatma", category: "REMINDER" as const, trigger: "APPOINTMENT_BEFORE" as const, triggerConfig: { offsetMin: -1440 },
    bodyRu: "Напоминание: завтра в {{appointment.time}} у вас приём — {{appointment.doctor}}. Чтобы подтвердить, ответьте YES (или ДА / HA).",
    bodyUz: "Eslatma: ertaga soat {{appointment.time}} da qabuluvingiz bor — {{appointment.doctor}}. Tasdiqlash uchun HA (yoki YES / ДА) deb javob bering." },
  { key: "reminder.5h",  nameRu: "Напоминание за 5 часов", nameUz: "5 soat oldin eslatma",  category: "REMINDER" as const, trigger: "APPOINTMENT_BEFORE" as const, triggerConfig: { offsetMin: -300 },
    bodyRu: "Здравствуйте, {{patient.firstName}}! Напоминаем: сегодня в {{appointment.time}} у вас приём — {{appointment.doctor}}. Адрес: {{clinic.address}}. Тел: {{clinic.phone}}.",
    bodyUz: "Assalomu alaykum, {{patient.firstName}}! Eslatma: bugun soat {{appointment.time}} da qabulga yoziluvingiz bor — {{appointment.doctor}}. Manzil: {{clinic.address}}. Tel: {{clinic.phone}}." },
  { key: "reminder.2h",  nameRu: "Напоминание за 2 часа",  nameUz: "2 soat oldin eslatma",  category: "REMINDER" as const, trigger: "APPOINTMENT_BEFORE" as const, triggerConfig: { offsetMin: -120 },
    bodyRu: "Через 2 часа приём — {{appointment.doctor}}. Чтобы подтвердить, ответьте YES (или ДА / HA).",
    bodyUz: "2 soatdan so'ng qabul — {{appointment.doctor}}. Tasdiqlash uchun HA (yoki YES / ДА) deb javob bering." },
  { key: "reminder.confirm", nameRu: "Подтверждение записи", nameUz: "Yozuv tasdiqlash", category: "REMINDER" as const, trigger: "APPOINTMENT_CREATED" as const, triggerConfig: null },
  { key: "reminder.missed", nameRu: "Не пришли на приём", nameUz: "Qabulga kelmadingiz", category: "REMINDER" as const, trigger: "APPOINTMENT_MISSED" as const, triggerConfig: { offsetMin: 30 } },
  { key: "reminder.feedback", nameRu: "Оставьте отзыв", nameUz: "Fikr qoldiring", category: "REMINDER" as const, trigger: "APPOINTMENT_COMPLETED" as const, triggerConfig: { offsetMin: 60 } },
  // Repeat-visit reminder (MedicalCase free-repeat window) — fires N days
  // before the free-repeat policy expires for the case's primary service.
  { key: "case.repeat-due", nameRu: "Бесплатный повторный визит", nameUz: "Bepul takroriy qabul", category: "REMINDER" as const, trigger: "CASE_REPEAT_DUE" as const, triggerConfig: { daysBefore: 2 },
    bodyRu: "Здравствуйте, {{patient.firstName}}! У вас осталось {{case.daysLeft}} дн. на бесплатный повторный приём в {{clinic.name}}. Запишитесь до {{case.deadline}}. Тел: {{clinic.phone}}.",
    bodyUz: "Assalomu alaykum, {{patient.firstName}}! {{clinic.name}}da bepul takroriy qabulga {{case.daysLeft}} kun qoldi. {{case.deadline}} gacha yozilib oling. Tel: {{clinic.phone}}." },
  // 3 marketing
  { key: "marketing.birthday", nameRu: "С днём рождения", nameUz: "Tug'ilgan kuningiz bilan", category: "MARKETING" as const, trigger: "PATIENT_BIRTHDAY" as const, triggerConfig: null },
  { key: "marketing.dormant", nameRu: "Давно не были", nameUz: "Uzoqdan ko'rinmadingiz", category: "MARKETING" as const, trigger: "PATIENT_INACTIVE_DAYS" as const, triggerConfig: { days: 180 } },
  { key: "marketing.promo", nameRu: "Акция месяца", nameUz: "Oy aksiyasi", category: "MARKETING" as const, trigger: "MANUAL" as const, triggerConfig: null },
  // 2 transactional
  { key: "transactional.payment", nameRu: "Чек об оплате", nameUz: "To'lov cheki", category: "TRANSACTIONAL" as const, trigger: "MANUAL" as const, triggerConfig: null },
  { key: "transactional.document", nameRu: "Готов ваш документ", nameUz: "Hujjatingiz tayyor", category: "TRANSACTIONAL" as const, trigger: "MANUAL" as const, triggerConfig: null },
];

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding MedBook/NeuroFax phase-1 data…");

  const superPassHash = await bcrypt.hash("super", 10);
  const adminPassHash = await bcrypt.hash("admin", 10);
  const doctorPassHash = await bcrypt.hash("doctor", 10);
  const receptPassHash = await bcrypt.hash("recept", 10);
  const devShortcutPassHash = await bcrypt.hash("1", 10);

  // ── SUPER_ADMIN (no clinicId) ─────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: "super@neurofax.uz" },
    update: {
      role: "SUPER_ADMIN",
      name: "Super Admin",
      passwordHash: superPassHash,
      active: true,
    },
    create: {
      email: "super@neurofax.uz",
      role: "SUPER_ADMIN",
      name: "Super Admin",
      passwordHash: superPassHash,
    },
  });

  for (const cs of clinicsToSeed) {
    const clinic = await prisma.clinic.upsert({
      where: { slug: cs.slug },
      update: {
        nameRu: cs.nameRu,
        nameUz: cs.nameUz,
        addressRu: cs.addressRu,
        addressUz: cs.addressUz,
        phone: cs.phone,
        email: cs.email,
        brandColor: cs.brandColor,
        active: true,
      },
      create: {
        slug: cs.slug,
        nameRu: cs.nameRu,
        nameUz: cs.nameUz,
        addressRu: cs.addressRu,
        addressUz: cs.addressUz,
        phone: cs.phone,
        email: cs.email,
        brandColor: cs.brandColor,
        currency: "UZS",
        secondaryCurrency: "USD",
      },
    });

    // ── Subscription (Phase 9b) — every seeded clinic gets a TRIAL on `pro`.
    //    The migration seeds the three canonical plans + backfills production
    //    clinics; here we keep the dev seed idempotent on its own. The `pro`
    //    plan is created by the migration; we just look it up.
    const proPlan = await prisma.plan.findUnique({ where: { slug: "pro" } });
    if (!proPlan) {
      throw new Error(
        "[seed] `pro` plan missing — run `npx prisma migrate dev` first."
      );
    }
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.subscription.upsert({
      where: { clinicId: clinic.id },
      update: {
        // Don't clobber an existing live subscription's status during reseed.
        planId: proPlan.id,
      },
      create: {
        clinicId: clinic.id,
        planId: proPlan.id,
        status: "TRIAL",
        trialEndsAt,
      },
    });

    // ── Default Branch (slug='hq') — Phase 9a. Doctor / Cabinet / Appointment /
    //    DoctorSchedule / DoctorTimeOff get pinned to this branch so demo
    //    flows have a non-null branchId end-to-end. Idempotent via the unique
    //    (clinicId, slug) index.
    const defaultBranch = await prisma.branch.upsert({
      where: { clinicId_slug: { clinicId: clinic.id, slug: "hq" } },
      update: {
        nameRu: "Главный филиал",
        nameUz: "Asosiy filial",
        isDefault: true,
        isActive: true,
      },
      create: {
        clinicId: clinic.id,
        slug: "hq",
        nameRu: "Главный филиал",
        nameUz: "Asosiy filial",
        isDefault: true,
        isActive: true,
      },
    });

    // ── Exchange rate today: 1 USD = 12700 UZS → store rate as UZS→USD (1/12700)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.exchangeRate.upsert({
      where: { clinicId_date: { clinicId: clinic.id, date: today } },
      update: { rateUsd: 1 / 12700, source: "seed" },
      create: { clinicId: clinic.id, date: today, rateUsd: 1 / 12700, source: "seed" },
    });

    // ── 1 ADMIN ───────────────────────────────────────────────────────
    const adminEmail = `admin@${cs.slug === "neurofax" ? "neurofax.uz" : "demo-clinic.uz"}`;
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        name: `${cs.nameRu} — Администратор`,
        passwordHash: adminPassHash,
        role: "ADMIN",
        clinicId: clinic.id,
        active: true,
      },
      create: {
        email: adminEmail,
        name: `${cs.nameRu} — Администратор`,
        passwordHash: adminPassHash,
        role: "ADMIN",
        clinicId: clinic.id,
      },
    });

    // ── DEV SHORTCUT: "1"/"1" ADMIN for the primary clinic only ───────
    if (cs.slug === "neurofax") {
      await prisma.user.upsert({
        where: { email: "1@1.uz" },
        update: {
          name: "Dev Admin (1/1)",
          passwordHash: devShortcutPassHash,
          role: "ADMIN",
          clinicId: clinic.id,
          active: true,
          mustChangePassword: false,
        },
        create: {
          email: "1@1.uz",
          name: "Dev Admin (1/1)",
          passwordHash: devShortcutPassHash,
          role: "ADMIN",
          clinicId: clinic.id,
          mustChangePassword: false,
        },
      });
    }

    // ── 1 RECEPTIONIST ────────────────────────────────────────────────
    const receptEmail = `recept@${cs.slug === "neurofax" ? "neurofax.uz" : "demo-clinic.uz"}`;
    await prisma.user.upsert({
      where: { email: receptEmail },
      update: {
        name: `${cs.nameRu} — Ресепшн`,
        passwordHash: receptPassHash,
        role: "RECEPTIONIST",
        clinicId: clinic.id,
        active: true,
      },
      create: {
        email: receptEmail,
        name: `${cs.nameRu} — Ресепшн`,
        passwordHash: receptPassHash,
        role: "RECEPTIONIST",
        clinicId: clinic.id,
      },
    });

    // ── 2 DOCTORs ─────────────────────────────────────────────────────
    const doctorDefs = [
      { slug: "neurologist", nameRu: "Ахмедов Акмаль Ботирович", nameUz: "Ahmedov Akmal Botirovich", specializationRu: "Невролог", specializationUz: "Nevropatolog", color: "#3DD5C0" },
      { slug: "cardiologist", nameRu: "Каримова Шахноза Алишеровна", nameUz: "Karimova Shaxnoza Alisherovna", specializationRu: "Кардиолог", specializationUz: "Kardiolog", color: "#F59E0B" },
    ];

    const createdDoctors: { id: string; userId: string | null }[] = [];
    for (const d of doctorDefs) {
      const docEmail = `${d.slug}@${cs.slug}.uz`;
      const user = await prisma.user.upsert({
        where: { email: docEmail },
        update: {
          name: d.nameRu,
          passwordHash: doctorPassHash,
          role: "DOCTOR",
          clinicId: clinic.id,
          active: true,
        },
        create: {
          email: docEmail,
          name: d.nameRu,
          passwordHash: doctorPassHash,
          role: "DOCTOR",
          clinicId: clinic.id,
        },
      });

      // Upsert doctor via composite unique (clinicId, slug)
      const doctor = await prisma.doctor.upsert({
        where: { clinicId_slug: { clinicId: clinic.id, slug: d.slug } },
        update: {
          nameRu: d.nameRu,
          nameUz: d.nameUz,
          specializationRu: d.specializationRu,
          specializationUz: d.specializationUz,
          color: d.color,
          userId: user.id,
          branchId: defaultBranch.id,
          isActive: true,
        },
        create: {
          clinicId: clinic.id,
          branchId: defaultBranch.id,
          slug: d.slug,
          nameRu: d.nameRu,
          nameUz: d.nameUz,
          specializationRu: d.specializationRu,
          specializationUz: d.specializationUz,
          color: d.color,
          userId: user.id,
        },
      });

      createdDoctors.push({ id: doctor.id, userId: user.id });

      // ── DoctorPreset chips (idempotent) ─────────────────────────────
      // Wipe + reseed each run so demo data tracks any updates to the
      // hard-coded list. Production doctors manage their own presets via
      // /doctor/settings; this only seeds the two demo accounts.
      const presets = PRESETS_BY_SLUG[d.slug];
      if (presets) {
        await prisma.doctorPreset.deleteMany({
          where: { clinicId: clinic.id, doctorId: doctor.id },
        });
        await prisma.doctorPreset.createMany({
          data: presets.map((p, i) => ({
            clinicId: clinic.id,
            doctorId: doctor.id,
            field: p.field,
            label: p.label,
            fieldValue: p.fieldValue ?? p.label,
            noteTemplate: p.noteTemplate ?? null,
            sortOrder: i,
          })),
        });
      }

      // Schedule Mon–Fri (weekday 1..5) 09:00-18:00
      for (let weekday = 1; weekday <= 5; weekday++) {
        const existing = await prisma.doctorSchedule.findFirst({
          where: { clinicId: clinic.id, doctorId: doctor.id, weekday },
        });
        if (existing) {
          await prisma.doctorSchedule.update({
            where: { id: existing.id },
            data: {
              startTime: "09:00",
              endTime: "18:00",
              isActive: true,
              branchId: defaultBranch.id,
            },
          });
        } else {
          await prisma.doctorSchedule.create({
            data: {
              clinicId: clinic.id,
              branchId: defaultBranch.id,
              doctorId: doctor.id,
              weekday,
              startTime: "09:00",
              endTime: "18:00",
            },
          });
        }
      }
    }

    // ── 2 Cabinets ────────────────────────────────────────────────────
    const cabs = [
      { number: "101", floor: 1, nameRu: "Кабинет 101", nameUz: "101-xona" },
      { number: "102", floor: 1, nameRu: "Кабинет 102", nameUz: "102-xona" },
    ];
    const createdCabinets: { id: string }[] = [];
    for (const c of cabs) {
      const cab = await prisma.cabinet.upsert({
        where: { clinicId_number: { clinicId: clinic.id, number: c.number } },
        update: {
          floor: c.floor,
          nameRu: c.nameRu,
          nameUz: c.nameUz,
          isActive: true,
          branchId: defaultBranch.id,
        },
        create: {
          clinicId: clinic.id,
          branchId: defaultBranch.id,
          ...c,
          equipment: [],
        },
      });
      createdCabinets.push({ id: cab.id });
    }

    // ── 5 Services ────────────────────────────────────────────────────
    const createdServices: { id: string; priceBase: number }[] = [];
    for (const s of SERVICE_TEMPLATES) {
      const svc = await prisma.service.upsert({
        where: { clinicId_code: { clinicId: clinic.id, code: s.code } },
        update: {
          nameRu: s.nameRu,
          nameUz: s.nameUz,
          durationMin: s.durationMin,
          priceBase: s.priceBase,
          category: s.category,
          isActive: true,
        },
        create: {
          clinicId: clinic.id,
          code: s.code,
          nameRu: s.nameRu,
          nameUz: s.nameUz,
          durationMin: s.durationMin,
          priceBase: s.priceBase,
          category: s.category,
        },
      });
      createdServices.push({ id: svc.id, priceBase: s.priceBase });

      // Link all services to all doctors (many-to-many via ServiceOnDoctor)
      for (const d of createdDoctors) {
        await prisma.serviceOnDoctor.upsert({
          where: { doctorId_serviceId: { doctorId: d.id, serviceId: svc.id } },
          update: {},
          create: { doctorId: d.id, serviceId: svc.id },
        });
      }
    }

    // ── 10 Patients ───────────────────────────────────────────────────
    const createdPatients: { id: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const first = pick(FIRST_NAMES_RU);
      const last = pick(LAST_NAMES_RU);
      const rawPhone = `${900000000 + Math.floor(Math.random() * 99_999_999)}`;
      const phone = rawPhone.slice(-9);
      const normalized = normalizePhone(phone);

      // Avoid duplicate phone normalization collisions per clinic
      const existing = await prisma.patient.findUnique({
        where: { clinicId_phoneNormalized: { clinicId: clinic.id, phoneNormalized: normalized } },
      });
      if (existing) {
        createdPatients.push({ id: existing.id });
        continue;
      }

      const p = await prisma.$transaction(async (tx) => {
        const c = await tx.clinic.update({
          where: { id: clinic.id },
          data: { patientCounter: { increment: 1 } },
          select: { patientCounter: true },
        });
        return tx.patient.create({
          data: {
            clinicId: clinic.id,
            patientNumber: c.patientCounter,
            fullName: `${last} ${first}`,
            phone,
            phoneNormalized: normalized,
            gender: Math.random() > 0.5 ? "MALE" : "FEMALE",
            segment: pick(["NEW", "ACTIVE", "DORMANT", "VIP"] as const),
            preferredChannel: "TG",
            preferredLang: "RU",
            consentMarketing: Math.random() > 0.3,
          },
        });
      });
      createdPatients.push({ id: p.id });
    }

    // ── 20 Appointments over the next 7 days ─────────────────────────
    const now = new Date();
    const statuses = ["BOOKED", "COMPLETED", "CANCELLED", "BOOKED", "BOOKED"] as const;
    for (let i = 0; i < 20; i++) {
      const dayOffset = Math.floor(Math.random() * 7);
      const startHour = 9 + Math.floor(Math.random() * 8);
      const date = atHour(addDays(now, dayOffset), startHour);
      const duration = 30;
      const endDate = new Date(date.getTime() + duration * 60_000);
      const doctor = pick(createdDoctors);
      const patient = pick(createdPatients);
      const cabinet = pick(createdCabinets);
      const service = pick(createdServices);
      const status = pick(statuses);

      const appt = await prisma.appointment.create({
        data: {
          clinicId: clinic.id,
          branchId: defaultBranch.id,
          patientId: patient.id,
          doctorId: doctor.id,
          cabinetId: cabinet.id,
          serviceId: service.id,
          date,
          durationMin: duration,
          endDate,
          status,
          queueStatus: status,
          channel: pick(["WALKIN", "PHONE", "TELEGRAM", "WEBSITE"] as const),
          priceService: service.priceBase,
          priceBase: service.priceBase,
          priceFinal: service.priceBase,
          completedAt: status === "COMPLETED" ? new Date(endDate.getTime()) : null,
          cancelledAt: status === "CANCELLED" ? new Date(date.getTime()) : null,
        },
      });

      await prisma.appointmentService.create({
        data: {
          clinicId: clinic.id,
          appointmentId: appt.id,
          serviceId: service.id,
          priceSnap: service.priceBase,
          quantity: 1,
        },
      });

      // Seed a PAID payment for completed appointments
      if (status === "COMPLETED") {
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
      }
    }

    // ── Reminders + LabResults (Phase 20 Wave 5a) ─────────────────────
    // Each doctor gets a few PENDING reminders (so /doctor/my-day "Дела
    // на сегодня" is not empty) + 3-5 RESULTED labs (so the «Анализы»
    // unread feed has something to render). Idempotent — skip if any row
    // already exists for the doctor in this clinic.
    const reminderTitles = [
      "Перезвонить пациенту по результатам",
      "Заказать повторный ОАК",
      "Уточнить дозу препарата у фармацевта",
      "Подготовить выписку",
      "Проверить рецепт",
    ];
    const labCatalog: Array<{
      testName: string;
      unit: string | null;
      refRange: string | null;
      values: Array<{ value: string; flag: "NORMAL" | "LOW" | "HIGH" | "CRITICAL" | null }>;
    }> = [
      {
        testName: "Глюкоза крови",
        unit: "ммоль/л",
        refRange: "3.3-5.5",
        values: [
          { value: "5.1", flag: "NORMAL" },
          { value: "6.4", flag: "HIGH" },
          { value: "3.0", flag: "LOW" },
        ],
      },
      {
        testName: "Гемоглобин",
        unit: "г/л",
        refRange: "120-160",
        values: [
          { value: "135", flag: "NORMAL" },
          { value: "108", flag: "LOW" },
        ],
      },
      {
        testName: "Холестерин общий",
        unit: "ммоль/л",
        refRange: "3.0-5.2",
        values: [
          { value: "4.5", flag: "NORMAL" },
          { value: "7.8", flag: "HIGH" },
          { value: "9.2", flag: "CRITICAL" },
        ],
      },
      {
        testName: "ТТГ",
        unit: "мЕд/л",
        refRange: "0.4-4.0",
        values: [
          { value: "2.1", flag: "NORMAL" },
          { value: "5.8", flag: "HIGH" },
        ],
      },
      {
        testName: "СОЭ",
        unit: "мм/ч",
        refRange: "2-15",
        values: [
          { value: "8", flag: "NORMAL" },
          { value: "32", flag: "HIGH" },
        ],
      },
    ];
    for (const d of createdDoctors) {
      if (!d.userId) continue;

      const existingReminders = await prisma.reminder.count({
        where: { clinicId: clinic.id, doctorId: d.userId },
      });
      if (existingReminders === 0) {
        for (let i = 0; i < 3; i++) {
          const title = pick(reminderTitles);
          // Spread reminders across the next 24h so the default
          // (status=PENDING|SNOOZED, remindAt<=now+24h) feed has content.
          const remindAt = new Date(now.getTime() + Math.random() * 22 * 3_600_000);
          const patient = i === 0 ? null : pick(createdPatients);
          await prisma.reminder.create({
            data: {
              clinicId: clinic.id,
              doctorId: d.userId,
              patientId: patient?.id ?? null,
              title,
              remindAt,
              status: "PENDING",
            },
          });
        }
      }

      const existingLabs = await prisma.labResult.count({
        where: { clinicId: clinic.id, doctorId: d.userId },
      });
      if (existingLabs === 0) {
        const labCount = 3 + Math.floor(Math.random() * 3); // 3..5
        for (let i = 0; i < labCount; i++) {
          const test = pick(labCatalog);
          const v = pick(test.values);
          const patient = pick(createdPatients);
          // Spread receivedAt across the last 14 days so timeline ordering
          // is realistic.
          const receivedAt = new Date(
            now.getTime() - Math.random() * 14 * 24 * 3_600_000,
          );
          await prisma.labResult.create({
            data: {
              clinicId: clinic.id,
              doctorId: d.userId,
              patientId: patient.id,
              testName: test.testName,
              value: v.value,
              unit: test.unit,
              refRange: test.refRange,
              flag: v.flag,
              status: "RESULTED",
              receivedAt,
            },
          });
        }
      }
    }

    // ── 10 NotificationTemplates ─────────────────────────────────────
    for (const t of TEMPLATE_SEEDS) {
      const tWithBody = t as typeof t & { bodyRu?: string; bodyUz?: string };
      const bodyRu = tWithBody.bodyRu ?? `Здравствуйте, {{patient.fullName}}! ${t.nameRu}.`;
      const bodyUz = tWithBody.bodyUz ?? `Assalomu alaykum, {{patient.fullName}}! ${t.nameUz}.`;
      await prisma.notificationTemplate.upsert({
        where: { clinicId_key: { clinicId: clinic.id, key: t.key } },
        update: {
          nameRu: t.nameRu,
          nameUz: t.nameUz,
          category: t.category,
          trigger: t.trigger,
          triggerConfig: t.triggerConfig as any,
          bodyRu,
          bodyUz,
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
          bodyRu,
          bodyUz,
          variables: ["patient.fullName", "appointment.date"],
        },
      });
    }

    console.log(`  ✔ ${cs.slug} seeded`);
  }

  console.log("Done.");
  console.log("Accounts:");
  console.log("  super@neurofax.uz / super         (SUPER_ADMIN)");
  console.log("  admin@neurofax.uz / admin         (ADMIN neurofax)");
  console.log("  admin@demo-clinic.uz / admin      (ADMIN demo-clinic)");
  console.log("  recept@neurofax.uz / recept       (RECEPTIONIST neurofax)");
  console.log("  1@1.uz / 1                        (ADMIN neurofax — dev shortcut)");
  console.log("  recept@demo-clinic.uz / recept    (RECEPTIONIST demo-clinic)");
  console.log("  <slug>@<clinic>.uz / doctor       (DOCTOR)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
