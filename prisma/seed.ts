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

const SERVICE_TEMPLATES = [
  { code: "CONSULT", nameRu: "Консультация", nameUz: "Konsultatsiya", durationMin: 30, priceBase: 200_000 * 100, category: "Консультация" },
  { code: "EEG", nameRu: "ЭЭГ", nameUz: "EEG", durationMin: 60, priceBase: 150_000 * 100, category: "Диагностика" },
  { code: "ECG", nameRu: "ЭКГ", nameUz: "EKG", durationMin: 30, priceBase: 70_000 * 100, category: "Диагностика" },
  { code: "UZI", nameRu: "УЗИ (1 орган)", nameUz: "UZI (1 organ)", durationMin: 30, priceBase: 80_000 * 100, category: "УЗИ" },
  { code: "ECHO_KG", nameRu: "ЭхоКГ", nameUz: "ExoKG", durationMin: 45, priceBase: 150_000 * 100, category: "УЗИ" },
];

const TEMPLATE_SEEDS = [
  // 5 reminders
  { key: "reminder.24h", nameRu: "Напоминание за 24 часа", nameUz: "24 soat oldin eslatma", category: "REMINDER" as const, trigger: "APPOINTMENT_BEFORE" as const, triggerConfig: { offsetMin: -1440 } },
  { key: "reminder.2h",  nameRu: "Напоминание за 2 часа",  nameUz: "2 soat oldin eslatma",  category: "REMINDER" as const, trigger: "APPOINTMENT_BEFORE" as const, triggerConfig: { offsetMin: -120 } },
  { key: "reminder.confirm", nameRu: "Подтверждение записи", nameUz: "Yozuv tasdiqlash", category: "REMINDER" as const, trigger: "APPOINTMENT_CREATED" as const, triggerConfig: null },
  { key: "reminder.missed", nameRu: "Не пришли на приём", nameUz: "Qabulga kelmadingiz", category: "REMINDER" as const, trigger: "APPOINTMENT_MISSED" as const, triggerConfig: { offsetMin: 30 } },
  { key: "reminder.feedback", nameRu: "Оставьте отзыв", nameUz: "Fikr qoldiring", category: "REMINDER" as const, trigger: "APPOINTMENT_COMPLETED" as const, triggerConfig: { offsetMin: 60 } },
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

      const p = await prisma.patient.create({
        data: {
          clinicId: clinic.id,
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

    // ── 10 NotificationTemplates ─────────────────────────────────────
    for (const t of TEMPLATE_SEEDS) {
      const bodyRu = `Здравствуйте, {{patient.fullName}}! ${t.nameRu}.`;
      const bodyUz = `Assalomu alaykum, {{patient.fullName}}! ${t.nameUz}.`;
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
  console.log("  recept@demo-clinic.uz / recept    (RECEPTIONIST demo-clinic)");
  console.log("  <slug>@<clinic>.uz / doctor       (DOCTOR)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
