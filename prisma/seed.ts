import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Day-of-week constants: 0=Sun, 1=Mon, ..., 6=Sat
const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

interface DoctorSeed {
  id: string;
  nameRu: string;
  nameUz: string;
  specialtyRu: string;
  specialtyUz: string;
  cabinet: number;
  scheduleRu: string;
  scheduleUz: string;
  hours: string;
  /** Days this doctor accepts patients (0=Sun). All other days are inactive. */
  workDays: number[];
  startTime: string;
  endTime: string;
  services: { nameRu: string; nameUz: string; price: number }[];
  email: string;
}

const doctors: DoctorSeed[] = [
  // ── Кабинет №1 — Взрослый невролог ──────────────────────────────
  {
    id: "busakov",
    nameRu: "Бусаков Бахтияр Султанович",
    nameUz: "Busakov Baxtiyor Sultonovich",
    specialtyRu: "Взрослый невролог",
    specialtyUz: "Kattalar nevropatologi",
    cabinet: 1,
    scheduleRu: "Пн – Сб",
    scheduleUz: "Du – Sha",
    hours: "08:00 – 17:00",
    workDays: [MON, TUE, WED, THU, FRI, SAT],
    startTime: "08:00",
    endTime: "17:00",
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 250000 },
      { nameRu: "ЭЭГ", nameUz: "EEG", price: 100000 },
      { nameRu: "РеоЭГ", nameUz: "ReoEG", price: 60000 },
      { nameRu: "ЭхоЭГ", nameUz: "ExoEG", price: 40000 },
    ],
    email: "busakov@neurofax.uz",
  },

  // ── Кабинет №2 — Кардиология (двое врачей, разные дни) ──────────
  {
    id: "tyncherova",
    nameRu: "Тынчерова Найля Юсуфовна",
    nameUz: "Tincherova Naylya Yusufovna",
    specialtyRu: "Кардиолог",
    specialtyUz: "Kardiolog",
    cabinet: 2,
    scheduleRu: "Пн, Ср, Пт, Сб",
    scheduleUz: "Du, Chor, Ju, Sha",
    hours: "09:00 – 15:00",
    workDays: [MON, WED, FRI, SAT],
    startTime: "09:00",
    endTime: "15:00",
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 200000 },
      { nameRu: "ЭКГ", nameUz: "EKG", price: 70000 },
    ],
    email: "tyncherova@neurofax.uz",
  },
  {
    id: "mukhitdinova",
    nameRu: "Мухитдинова Шахноза Салахитдиновна",
    nameUz: "Muxitdinova Shaxnoza Salaxitdinovna",
    specialtyRu: "Кардиолог",
    specialtyUz: "Kardiolog",
    cabinet: 2,
    scheduleRu: "Вт, Чт",
    scheduleUz: "Se, Pay",
    hours: "09:30 – 15:00",
    workDays: [TUE, THU],
    startTime: "09:30",
    endTime: "15:00",
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 200000 },
      { nameRu: "Допплер БЦА", nameUz: "Dopler BTsA", price: 150000 },
      { nameRu: "ЭхоКГ", nameUz: "ExoKG", price: 150000 },
      { nameRu: "ЭКГ", nameUz: "EKG", price: 70000 },
    ],
    email: "mukhitdinova@neurofax.uz",
  },

  // ── Кабинет №4 — УЗИ и диагностика ──────────────────────────────
  {
    id: "rakhmanova",
    nameRu: "Рахманова Нигора Бахтияровна",
    nameUz: "Raxmanova Nigora Baxtiyorovna",
    specialtyRu: "УЗИ и диагностика",
    specialtyUz: "UZI va diagnostika",
    cabinet: 4,
    scheduleRu: "Пн – Сб",
    scheduleUz: "Du – Sha",
    hours: "10:00 – 14:00",
    workDays: [MON, TUE, WED, THU, FRI, SAT],
    startTime: "10:00",
    endTime: "14:00",
    services: [
      { nameRu: "УЗИ (1 орган)", nameUz: "UZI (1 organ)", price: 80000 },
      { nameRu: "НСГ", nameUz: "NSG", price: 80000 },
      { nameRu: "ЭЭГ (30 мин)", nameUz: "EEG (30 daq)", price: 150000 },
      { nameRu: "ЭЭГ (1 час)", nameUz: "EEG (1 soat)", price: 250000 },
    ],
    email: "rakhmanova@neurofax.uz",
  },

  // ── Кабинет №5 — Взрослый невролог ──────────────────────────────
  {
    id: "sultanov",
    nameRu: "Султанов Азиз Бахтиёр угли",
    nameUz: "Sultonov Aziz Baxtiyor o'g'li",
    specialtyRu: "Взрослый невролог",
    specialtyUz: "Kattalar nevropatologi",
    cabinet: 5,
    scheduleRu: "Пн – Сб",
    scheduleUz: "Du – Sha",
    hours: "08:00 – 17:00",
    workDays: [MON, TUE, WED, THU, FRI, SAT],
    startTime: "08:00",
    endTime: "17:00",
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 200000 },
      { nameRu: "ЭЭГ", nameUz: "EEG", price: 100000 },
      { nameRu: "РеоЭГ", nameUz: "ReoEG", price: 60000 },
      { nameRu: "ЭхоЭГ", nameUz: "ExoEG", price: 40000 },
    ],
    email: "sultanov@neurofax.uz",
  },

  // ── Кабинет №6 — Детский невролог и педиатр (двое врачей) ───────
  {
    id: "israilova",
    nameRu: "Исраилова Феруза Камиловна",
    nameUz: "Israilova Feruza Kamilovna",
    specialtyRu: "Детский невролог и педиатр",
    specialtyUz: "Bolalar nevropatologi va pediatr",
    cabinet: 6,
    scheduleRu: "Вт, Чт, Сб",
    scheduleUz: "Se, Pay, Sha",
    hours: "09:00 – 15:00",
    workDays: [TUE, THU, SAT],
    startTime: "09:00",
    endTime: "15:00",
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 200000 },
    ],
    email: "israilova@neurofax.uz",
  },
  {
    id: "vazirova",
    nameRu: "Вазирова Юлдуз Нурматовна",
    nameUz: "Vazirova Yulduz Nurmatovna",
    specialtyRu: "Детский невролог и педиатр",
    specialtyUz: "Bolalar nevropatologi va pediatr",
    cabinet: 6,
    scheduleRu: "Пн, Ср, Пт",
    scheduleUz: "Du, Chor, Ju",
    hours: "09:00 – 15:00",
    workDays: [MON, WED, FRI],
    startTime: "09:00",
    endTime: "15:00",
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 200000 },
    ],
    email: "vazirova@neurofax.uz",
  },
];

async function main() {
  const hashedPassword = await bcrypt.hash("neurofax2024", 10);

  // ── Retire old pediatric stub (if present from earlier seeds) ──
  // We keep it in DB (don't delete — appointments may FK to it) but mark inactive.
  await prisma.doctor.updateMany({
    where: { id: "pediatric" },
    data: { active: false },
  });
  await prisma.doctorSchedule.updateMany({
    where: { doctorId: "pediatric" },
    data: { isActive: false },
  });

  // ── Upsert doctors + user accounts ─────────────────────────────
  for (const doc of doctors) {
    const { email, workDays, startTime, endTime, ...doctorFields } = doc;

    // Force-update on re-seed so the landing/dashboard reflect current data.
    await prisma.doctor.upsert({
      where: { id: doc.id },
      update: { ...doctorFields, active: true },
      create: { ...doctorFields, active: true },
    });

    await prisma.user.upsert({
      where: { email },
      update: { name: doc.nameRu, role: "DOCTOR", doctorId: doc.id },
      create: {
        email,
        name: doc.nameRu,
        hashedPassword,
        role: "DOCTOR",
        doctorId: doc.id,
      },
    });

    // ── Per-doctor weekly schedule ────────────────────────────────
    // Each doctor works only on their declared workDays at their own hours.
    // All other days must be explicitly marked isActive:false so leftover
    // rows from old seeds don't keep stale days open for booking.
    for (let dow = 0; dow <= 6; dow++) {
      const isWorking = workDays.includes(dow);
      await prisma.doctorSchedule.upsert({
        where: { doctorId_dayOfWeek: { doctorId: doc.id, dayOfWeek: dow } },
        update: {
          startTime: isWorking ? startTime : "09:00",
          endTime: isWorking ? endTime : "18:00",
          isActive: isWorking,
        },
        create: {
          doctorId: doc.id,
          dayOfWeek: dow,
          startTime: isWorking ? startTime : "09:00",
          endTime: isWorking ? endTime : "18:00",
          isActive: isWorking,
        },
      });
    }
  }

  // ── Admin account ──────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: "admin@neurofax.uz" },
    update: {},
    create: {
      email: "admin@neurofax.uz",
      name: "Администратор",
      hashedPassword,
      role: "ADMIN",
    },
  });

  // ── Reviews (best 4, all 5-star, from Yandex Maps) ─────────────
  // Only seed reviews once — don't duplicate on re-seed.
  const existingReviews = await prisma.review.count();
  if (existingReviews === 0) {
    const reviews = [
      {
        authorName: "Мадина К.",
        rating: 5,
        text: "Отличный диагностический центр! Доктор Бусаков очень внимательный и профессиональный. Сделали ЭЭГ быстро и качественно. Результаты объяснили понятным языком. Рекомендую всем!",
        source: "yandex",
        publishedAt: new Date("2026-03-10"),
      },
      {
        authorName: "Алишер Т.",
        rating: 5,
        text: "Привёл ребёнка к детскому неврологу. Врач нашёл подход к малышу, провёл тщательный осмотр. Назначил лечение, через месяц уже видны улучшения. Спасибо большое!",
        source: "yandex",
        publishedAt: new Date("2026-02-22"),
      },
      {
        authorName: "Гулнора А.",
        rating: 5,
        text: "Кардиолог Тынчерова — замечательный врач! Внимательная, знающая. Сделали ЭКГ, всё объяснила. Наблюдаюсь у неё уже год. Очень довольна!",
        source: "yandex",
        publishedAt: new Date("2026-02-05"),
      },
      {
        authorName: "Фарход У.",
        rating: 5,
        text: "Лучший диагностический центр в районе! Все врачи профессионалы. Оборудование на уровне. Цены адекватные. Обращаюсь уже третий раз, всегда доволен.",
        source: "yandex",
        publishedAt: new Date("2026-01-18"),
      },
    ];

    for (const review of reviews) {
      await prisma.review.create({ data: review });
    }
  }

  console.log(`Seeded ${doctors.length} doctors + user accounts + per-day schedules`);
  console.log("Default password: neurofax2024");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
