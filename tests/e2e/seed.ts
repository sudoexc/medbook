/**
 * E2E seed — idempotent.
 *
 * Guarantees the following layout in the current DB:
 *   - Clinic "neurofax"      (primary — most tests run here)
 *   - Clinic "demo-clinic"   (used by tenancy-isolation tests)
 *   - Each clinic has: ADMIN, RECEPTIONIST, 3 DOCTORs (users linked)
 *   - 1 SUPER_ADMIN (super@neurofax.uz)
 *   - 10 services, 10 cabinets, 5 patients, 5 appointments-today per clinic
 *   - FX rate today (1 USD = 12700 UZS)
 *   - 10 notification templates per clinic
 *
 * Usage:
 *   npm run e2e:seed                         # idempotent
 *   DATABASE_URL=postgresql://... e2e:seed   # override DB
 *
 * Pure side-effect script — no exports beyond `main`.
 */

import "dotenv/config";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  return digits.startsWith("998") ? `+${digits}` : `+998${digits}`;
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

interface ClinicSeed {
  slug: string;
  nameRu: string;
  nameUz: string;
  phone: string;
  email: string;
  brandColor: string;
}

const CLINICS: ClinicSeed[] = [
  {
    slug: "neurofax",
    nameRu: "Диагностический центр NeuroFax",
    nameUz: "NeuroFax diagnostika markazi",
    phone: "+998712000001",
    email: "info@neurofax.uz",
    brandColor: "#3DD5C0",
  },
  {
    slug: "demo-clinic",
    nameRu: "Демо-клиника",
    nameUz: "Demo klinika",
    phone: "+998712000002",
    email: "info@demo-clinic.uz",
    brandColor: "#6366F1",
  },
];

const DOCTOR_DEFS = [
  { slug: "neurologist", nameRu: "Ахмедов Акмаль Ботирович", nameUz: "Ahmedov Akmal Botirovich", specializationRu: "Невролог", specializationUz: "Nevropatolog", color: "#3DD5C0" },
  { slug: "cardiologist", nameRu: "Каримова Шахноза Алишеровна", nameUz: "Karimova Shaxnoza Alisherovna", specializationRu: "Кардиолог", specializationUz: "Kardiolog", color: "#F59E0B" },
  { slug: "pediatrician", nameRu: "Юлдашев Бобур Алишерович", nameUz: "Yuldashev Bobur Alisherovich", specializationRu: "Педиатр", specializationUz: "Pediatr", color: "#8B5CF6" },
];

const SERVICE_TEMPLATES = [
  { code: "CONSULT",   nameRu: "Консультация",  nameUz: "Konsultatsiya",         durationMin: 30, priceBase: 200_000 * 100, category: "Консультация" },
  { code: "EEG",       nameRu: "ЭЭГ",           nameUz: "EEG",                   durationMin: 60, priceBase: 150_000 * 100, category: "Диагностика" },
  { code: "ECG",       nameRu: "ЭКГ",           nameUz: "EKG",                   durationMin: 30, priceBase: 70_000  * 100, category: "Диагностика" },
  { code: "UZI",       nameRu: "УЗИ (1 орган)", nameUz: "UZI (1 organ)",         durationMin: 30, priceBase: 80_000  * 100, category: "УЗИ" },
  { code: "ECHO_KG",   nameRu: "ЭхоКГ",         nameUz: "ExoKG",                 durationMin: 45, priceBase: 150_000 * 100, category: "УЗИ" },
  { code: "MRI_HEAD",  nameRu: "МРТ головы",    nameUz: "Kalla MRI",             durationMin: 60, priceBase: 500_000 * 100, category: "МРТ" },
  { code: "CT_CHEST",  nameRu: "КТ грудной кл.",nameUz: "Ko'krak KT",            durationMin: 45, priceBase: 450_000 * 100, category: "КТ" },
  { code: "BLOOD_CBC", nameRu: "ОАК",           nameUz: "UAM",                   durationMin: 15, priceBase: 50_000  * 100, category: "Лаборатория" },
  { code: "RTG_KNEE",  nameRu: "Рентген колена",nameUz: "Tizza rentgen",         durationMin: 20, priceBase: 90_000  * 100, category: "Рентген" },
  { code: "MASSAGE",   nameRu: "Массаж (1 сеанс)",nameUz: "Uqalash (1 seans)",   durationMin: 45, priceBase: 120_000 * 100, category: "Физио" },
];

const TEMPLATE_SEEDS = [
  { key: "reminder.24h",     nameRu: "Напоминание за 24ч",   nameUz: "24 soat oldin eslatma",     category: "REMINDER" as const,     trigger: "APPOINTMENT_BEFORE" as const,    triggerConfig: { offsetMin: -1440 } },
  { key: "reminder.2h",      nameRu: "Напоминание за 2ч",    nameUz: "2 soat oldin eslatma",      category: "REMINDER" as const,     trigger: "APPOINTMENT_BEFORE" as const,    triggerConfig: { offsetMin: -120 } },
  { key: "reminder.confirm", nameRu: "Подтверждение записи", nameUz: "Yozuv tasdiqlash",          category: "REMINDER" as const,     trigger: "APPOINTMENT_CREATED" as const,   triggerConfig: null },
  { key: "reminder.missed",  nameRu: "Не пришли на приём",   nameUz: "Qabulga kelmadingiz",       category: "REMINDER" as const,     trigger: "APPOINTMENT_MISSED" as const,    triggerConfig: { offsetMin: 30 } },
  { key: "reminder.feedback",nameRu: "Оставьте отзыв",       nameUz: "Fikr qoldiring",            category: "REMINDER" as const,     trigger: "APPOINTMENT_COMPLETED" as const, triggerConfig: { offsetMin: 60 } },
  { key: "marketing.birthday",nameRu: "С днём рождения",      nameUz: "Tug'ilgan kuningiz bilan",  category: "MARKETING" as const,    trigger: "PATIENT_BIRTHDAY" as const,      triggerConfig: null },
  { key: "marketing.dormant", nameRu: "Давно не были",        nameUz: "Uzoqdan ko'rinmadingiz",    category: "MARKETING" as const,    trigger: "PATIENT_INACTIVE_DAYS" as const, triggerConfig: { days: 180 } },
  { key: "marketing.promo",   nameRu: "Акция месяца",         nameUz: "Oy aksiyasi",               category: "MARKETING" as const,    trigger: "MANUAL" as const,                triggerConfig: null },
  { key: "transactional.payment",  nameRu: "Чек об оплате",   nameUz: "To'lov cheki",              category: "TRANSACTIONAL" as const, trigger: "MANUAL" as const,               triggerConfig: null },
  { key: "transactional.document", nameRu: "Готов документ",  nameUz: "Hujjat tayyor",             category: "TRANSACTIONAL" as const, trigger: "MANUAL" as const,               triggerConfig: null },
];

async function main() {
  console.log("[e2e-seed] start");

  const superHash = await bcrypt.hash("super", 10);
  const adminHash = await bcrypt.hash("admin", 10);
  const doctorHash = await bcrypt.hash("doctor", 10);
  const receptHash = await bcrypt.hash("recept", 10);

  // SUPER_ADMIN
  await prisma.user.upsert({
    where: { email: "super@neurofax.uz" },
    update: { role: "SUPER_ADMIN", name: "Super Admin", passwordHash: superHash, active: true },
    create: { email: "super@neurofax.uz", role: "SUPER_ADMIN", name: "Super Admin", passwordHash: superHash },
  });

  for (const cs of CLINICS) {
    const clinic = await prisma.clinic.upsert({
      where: { slug: cs.slug },
      update: {
        nameRu: cs.nameRu,
        nameUz: cs.nameUz,
        phone: cs.phone,
        email: cs.email,
        brandColor: cs.brandColor,
        active: true,
      },
      create: {
        slug: cs.slug,
        nameRu: cs.nameRu,
        nameUz: cs.nameUz,
        addressRu: "г. Ташкент, ул. Тест, 1",
        addressUz: "Toshkent sh., Test ko'ch., 1",
        phone: cs.phone,
        email: cs.email,
        brandColor: cs.brandColor,
        currency: "UZS",
        secondaryCurrency: "USD",
      },
    });

    // Default Branch (slug='hq') — Phase 9a. Doctors / Cabinets / Appointments
    // / DoctorSchedules get pinned to it so e2e flows have non-null branchId.
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

    // FX today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.exchangeRate.upsert({
      where: { clinicId_date: { clinicId: clinic.id, date: today } },
      update: { rateUsd: 1 / 12700, source: "seed" },
      create: { clinicId: clinic.id, date: today, rateUsd: 1 / 12700, source: "seed" },
    });

    // ADMIN
    const adminEmail = `admin@${cs.slug === "neurofax" ? "neurofax.uz" : "demo-clinic.uz"}`;
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { name: `${cs.nameRu} — Администратор`, passwordHash: adminHash, role: "ADMIN", clinicId: clinic.id, active: true },
      create: { email: adminEmail, name: `${cs.nameRu} — Администратор`, passwordHash: adminHash, role: "ADMIN", clinicId: clinic.id },
    });

    // RECEPTIONIST
    const receptEmail = `recept@${cs.slug === "neurofax" ? "neurofax.uz" : "demo-clinic.uz"}`;
    await prisma.user.upsert({
      where: { email: receptEmail },
      update: { name: `${cs.nameRu} — Ресепшн`, passwordHash: receptHash, role: "RECEPTIONIST", clinicId: clinic.id, active: true },
      create: { email: receptEmail, name: `${cs.nameRu} — Ресепшн`, passwordHash: receptHash, role: "RECEPTIONIST", clinicId: clinic.id },
    });

    // DOCTORs
    const createdDoctors: { id: string; userId: string | null }[] = [];
    for (const d of DOCTOR_DEFS) {
      const docEmail = `${d.slug}@${cs.slug}.uz`;
      const user = await prisma.user.upsert({
        where: { email: docEmail },
        update: { name: d.nameRu, passwordHash: doctorHash, role: "DOCTOR", clinicId: clinic.id, active: true },
        create: { email: docEmail, name: d.nameRu, passwordHash: doctorHash, role: "DOCTOR", clinicId: clinic.id },
      });
      const doctor = await prisma.doctor.upsert({
        where: { clinicId_slug: { clinicId: clinic.id, slug: d.slug } },
        update: {
          nameRu: d.nameRu, nameUz: d.nameUz,
          specializationRu: d.specializationRu, specializationUz: d.specializationUz,
          color: d.color, userId: user.id, branchId: defaultBranch.id, isActive: true,
        },
        create: {
          clinicId: clinic.id, branchId: defaultBranch.id, slug: d.slug,
          nameRu: d.nameRu, nameUz: d.nameUz,
          specializationRu: d.specializationRu, specializationUz: d.specializationUz,
          color: d.color, userId: user.id,
        },
      });
      createdDoctors.push({ id: doctor.id, userId: user.id });

      // Mon–Fri schedule
      for (let weekday = 1; weekday <= 5; weekday++) {
        const existing = await prisma.doctorSchedule.findFirst({
          where: { clinicId: clinic.id, doctorId: doctor.id, weekday },
        });
        if (existing) {
          await prisma.doctorSchedule.update({
            where: { id: existing.id },
            data: { startTime: "09:00", endTime: "18:00", isActive: true, branchId: defaultBranch.id },
          });
        } else {
          await prisma.doctorSchedule.create({
            data: { clinicId: clinic.id, branchId: defaultBranch.id, doctorId: doctor.id, weekday, startTime: "09:00", endTime: "18:00" },
          });
        }
      }
    }

    // 10 Cabinets
    const createdCabinets: { id: string }[] = [];
    for (let i = 1; i <= 10; i++) {
      const number = `10${i}`;
      const cab = await prisma.cabinet.upsert({
        where: { clinicId_number: { clinicId: clinic.id, number } },
        update: { floor: 1, nameRu: `Кабинет ${number}`, nameUz: `${number}-xona`, isActive: true, branchId: defaultBranch.id },
        create: { clinicId: clinic.id, branchId: defaultBranch.id, number, floor: 1, nameRu: `Кабинет ${number}`, nameUz: `${number}-xona`, equipment: [] },
      });
      createdCabinets.push({ id: cab.id });
    }

    // 10 Services + link to all doctors
    const createdServices: { id: string; priceBase: number }[] = [];
    for (const s of SERVICE_TEMPLATES) {
      const svc = await prisma.service.upsert({
        where: { clinicId_code: { clinicId: clinic.id, code: s.code } },
        update: {
          nameRu: s.nameRu, nameUz: s.nameUz,
          durationMin: s.durationMin, priceBase: s.priceBase,
          category: s.category, isActive: true,
        },
        create: {
          clinicId: clinic.id, code: s.code,
          nameRu: s.nameRu, nameUz: s.nameUz,
          durationMin: s.durationMin, priceBase: s.priceBase,
          category: s.category,
        },
      });
      createdServices.push({ id: svc.id, priceBase: s.priceBase });
      for (const d of createdDoctors) {
        await prisma.serviceOnDoctor.upsert({
          where: { doctorId_serviceId: { doctorId: d.id, serviceId: svc.id } },
          update: {},
          create: { doctorId: d.id, serviceId: svc.id },
        });
      }
    }

    // 5 Patients (deterministic phones per clinic so tests can reference them)
    const patientDefs = [
      { fullName: "Иванов Иван Иванович", phone: "901000011", gender: "MALE"   as const, segment: "ACTIVE" as const },
      { fullName: "Петрова Ольга Сергеевна", phone: "901000022", gender: "FEMALE" as const, segment: "NEW"    as const },
      { fullName: "Каримова Азиза",          phone: "901000033", gender: "FEMALE" as const, segment: "VIP"    as const },
      { fullName: "Тохиров Бобур",           phone: "901000044", gender: "MALE"   as const, segment: "ACTIVE" as const },
      { fullName: "Махмудов Фарход",         phone: "901000055", gender: "MALE"   as const, segment: "DORMANT"as const },
    ];
    const clinicPhoneSuffix = cs.slug === "neurofax" ? "0" : "9";
    const createdPatients: { id: string }[] = [];
    for (const p of patientDefs) {
      // differentiate phones between clinics so phoneNormalized never collides
      const raw = p.phone.slice(0, -1) + clinicPhoneSuffix;
      const normalized = normalizePhone(raw);
      const patient = await prisma.patient.upsert({
        where: { clinicId_phoneNormalized: { clinicId: clinic.id, phoneNormalized: normalized } },
        update: {
          fullName: p.fullName,
          gender: p.gender,
          segment: p.segment,
        },
        create: {
          clinicId: clinic.id,
          fullName: p.fullName,
          phone: raw,
          phoneNormalized: normalized,
          gender: p.gender,
          segment: p.segment,
          preferredChannel: "TG",
          preferredLang: "RU",
          consentMarketing: true,
        },
      });
      createdPatients.push({ id: patient.id });
    }

    // 5 Appointments today (idempotent by composite natural key: date+doctor+patient)
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const startHour = 10 + i; // 10:00, 11:00, ... 14:00
      const date = atHour(now, startHour);
      const duration = 30;
      const endDate = new Date(date.getTime() + duration * 60_000);
      const doctor = createdDoctors[i % createdDoctors.length];
      const patient = createdPatients[i % createdPatients.length];
      const cabinet = createdCabinets[i % createdCabinets.length];
      const service = createdServices[0]; // CONSULT

      const existing = await prisma.appointment.findFirst({
        where: {
          clinicId: clinic.id,
          doctorId: doctor.id,
          patientId: patient.id,
          date,
        },
      });
      if (existing) continue;

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
          status: "BOOKED",
          queueStatus: "BOOKED",
          channel: "WALKIN",
          priceService: service.priceBase,
          priceBase: service.priceBase,
          priceFinal: service.priceBase,
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
    }

    // 10 templates
    for (const t of TEMPLATE_SEEDS) {
      const bodyRu = `Здравствуйте, {{patient.fullName}}! ${t.nameRu}.`;
      const bodyUz = `Assalomu alaykum, {{patient.fullName}}! ${t.nameUz}.`;
      await prisma.notificationTemplate.upsert({
        where: { clinicId_key: { clinicId: clinic.id, key: t.key } },
        update: {
          nameRu: t.nameRu, nameUz: t.nameUz,
          category: t.category, trigger: t.trigger,
          triggerConfig: t.triggerConfig as never,
          bodyRu, bodyUz, isActive: true,
        },
        create: {
          clinicId: clinic.id, key: t.key,
          nameRu: t.nameRu, nameUz: t.nameUz,
          channel: "TG", category: t.category, trigger: t.trigger,
          triggerConfig: t.triggerConfig as never,
          bodyRu, bodyUz,
          variables: ["patient.fullName", "appointment.date"],
        },
      });
    }

    console.log(`[e2e-seed] ${cs.slug} OK`);
  }

  console.log("[e2e-seed] done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
