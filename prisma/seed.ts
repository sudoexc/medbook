import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const doctors = [
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
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 250000 },
      { nameRu: "ЭЭГ", nameUz: "EEG", price: 100000 },
      { nameRu: "РеоЭГ", nameUz: "ReoEG", price: 60000 },
      { nameRu: "ЭхоЭГ", nameUz: "ExoEG", price: 40000 },
    ],
    email: "busakov@neurofax.uz",
  },
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
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 200000 },
      { nameRu: "Допплер БЦА", nameUz: "Dopler BTsA", price: 150000 },
      { nameRu: "ЭхоКГ", nameUz: "ExoKG", price: 150000 },
      { nameRu: "ЭКГ", nameUz: "EKG", price: 70000 },
    ],
    email: "mukhitdinova@neurofax.uz",
  },
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
    services: [
      { nameRu: "УЗИ (1 орган)", nameUz: "UZI (1 organ)", price: 80000 },
      { nameRu: "НСГ", nameUz: "NSG", price: 80000 },
      { nameRu: "ЭЭГ (30 мин)", nameUz: "EEG (30 daq)", price: 150000 },
      { nameRu: "ЭЭГ (1 час)", nameUz: "EEG (1 soat)", price: 250000 },
    ],
    email: "rakhmanova@neurofax.uz",
  },
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
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 200000 },
      { nameRu: "ЭЭГ", nameUz: "EEG", price: 100000 },
      { nameRu: "РеоЭГ", nameUz: "ReoEG", price: 60000 },
      { nameRu: "ЭхоЭГ", nameUz: "ExoEG", price: 40000 },
    ],
    email: "sultanov@neurofax.uz",
  },
  {
    id: "pediatric",
    nameRu: "Детский невролог",
    nameUz: "Bolalar nevropatologi",
    specialtyRu: "Детский невролог и педиатр",
    specialtyUz: "Bolalar nevropatologi va pediatr",
    cabinet: 6,
    scheduleRu: "Пн – Сб",
    scheduleUz: "Du – Sha",
    hours: "09:00 – 15:00",
    services: [
      { nameRu: "Консультация", nameUz: "Konsultatsiya", price: 200000 },
    ],
    email: "pediatric@neurofax.uz",
  },
];

async function main() {
  const hashedPassword = await bcrypt.hash("neurofax2024", 10);

  // Create doctors
  for (const doc of doctors) {
    const { email, ...doctorData } = doc;
    await prisma.doctor.upsert({
      where: { id: doc.id },
      update: {},
      create: doctorData,
    });

    // Create user account for this doctor
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: doc.nameRu,
        hashedPassword,
        role: "DOCTOR",
        doctorId: doc.id,
      },
    });
  }

  // Create admin
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

  // Create default schedules: Mon-Sat 08:00-17:00
  for (const doc of doctors) {
    for (let dow = 1; dow <= 6; dow++) {
      await prisma.doctorSchedule.upsert({
        where: { doctorId_dayOfWeek: { doctorId: doc.id, dayOfWeek: dow } },
        update: {},
        create: { doctorId: doc.id, dayOfWeek: dow, startTime: "08:00", endTime: "17:00", isActive: true },
      });
    }
    // Sunday off
    await prisma.doctorSchedule.upsert({
      where: { doctorId_dayOfWeek: { doctorId: doc.id, dayOfWeek: 0 } },
      update: {},
      create: { doctorId: doc.id, dayOfWeek: 0, startTime: "08:00", endTime: "17:00", isActive: false },
    });
  }

  // Seed reviews (best 4, all 5-star, from Yandex Maps)
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

  console.log("Seeded 6 doctors + 7 user accounts + schedules + 4 reviews");
  console.log("Default password: neurofax2024");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
