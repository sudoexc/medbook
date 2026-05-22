/**
 * Ultra-realistic clinical seeder for the `neurofax` clinic.
 *
 * Runs AFTER `seed-demo-data.ts` so the demo patients/appointments already
 * exist. Layers on the clinical artefacts that turn a populated DB into a
 * "clinic that's been operating all year": visit notes, lab orders+results,
 * e-prescriptions, prescriptions w/ medication reminders, patient medical
 * history (allergies / chronic conditions / diagnoses), reviews, the
 * Communication audit trail, and a year of AuditLog noise.
 *
 * Idempotent: rows are tagged with the `[ultra]` marker in notes/title/
 * meta fields, and previous-run rows are wiped before re-creating.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const SLUG = process.env.CLINIC_SLUG ?? "neurofax";
const TAG_DEMO = "demo:";
const TAG_ULTRA = "[ultra]";

function pick<T>(arr: readonly T[], i?: number): T {
  return arr[(i ?? Math.floor(Math.random() * arr.length)) % arr.length]!;
}
function rndInt(lo: number, hi: number) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function chance(p: number) {
  return Math.random() < p;
}
function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 24 * 3_600_000);
}
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}
function minutesFromNow(m: number): Date {
  return new Date(Date.now() + m * 60_000);
}

// ─── Content libraries ─────────────────────────────────────────────────

const ALLERGIES = [
  { substance: "Пенициллин", reaction: "Кожная сыпь, зуд", severity: "MODERATE" },
  { substance: "Анальгин", reaction: "Отёк Квинке", severity: "SEVERE" },
  { substance: "Йод", reaction: "Локальная гиперемия", severity: "MILD" },
  { substance: "Цитрусовые", reaction: "Крапивница", severity: "MILD" },
  { substance: "Орехи", reaction: "Затруднённое дыхание", severity: "SEVERE" },
  { substance: "Цефалоспорины", reaction: "Сыпь", severity: "MODERATE" },
  { substance: "Лидокаин", reaction: "Бронхоспазм в анамнезе", severity: "SEVERE" },
  { substance: "Пыль", reaction: "Ринит, чихание", severity: "MILD" },
  { substance: "Пыльца берёзы", reaction: "Сезонный ринит", severity: "MILD" },
  { substance: "Молочные продукты", reaction: "Расстройство ЖКТ", severity: "MILD" },
  { substance: "Аспирин (НПВС)", reaction: "Бронхоспазм", severity: "MODERATE" },
  { substance: "Шерсть кошки", reaction: "Ринит, конъюнктивит", severity: "MILD" },
  { substance: "Сульфаниламиды", reaction: "Сыпь", severity: "MODERATE" },
] as const;

const CHRONIC = [
  "Гипертоническая болезнь I ст.",
  "Гипертоническая болезнь II ст.",
  "Сахарный диабет 2 типа",
  "Хронический гастрит",
  "Остеохондроз шейного отдела позвоночника",
  "Мигрень без ауры",
  "Хроническая ишемическая болезнь сердца",
  "Бронхиальная астма (атопическая)",
  "Хронический пиелонефрит",
  "ВСД по гипотоническому типу",
  "Гипотиреоз (компенсированный)",
  "Хронический холецистит",
  "Жировой гепатоз печени",
  "Дисциркуляторная энцефалопатия I ст.",
  "Депрессивный эпизод (умеренный)",
] as const;

const DIAGNOSES = [
  { icd10Code: "G43.0", label: "Мигрень без ауры" },
  { icd10Code: "G44.2", label: "Головная боль напряжения" },
  { icd10Code: "M54.2", label: "Цервикалгия" },
  { icd10Code: "M54.5", label: "Боль внизу спины" },
  { icd10Code: "I10", label: "Эссенциальная (первичная) гипертензия" },
  { icd10Code: "I20.0", label: "Нестабильная стенокардия" },
  { icd10Code: "I25.1", label: "Атеросклеротическая болезнь сердца" },
  { icd10Code: "I63.3", label: "Инфаркт мозга (последствия)" },
  { icd10Code: "G47.0", label: "Бессонница" },
  { icd10Code: "G93.4", label: "Энцефалопатия неуточнённая" },
  { icd10Code: "F41.1", label: "Генерализованное тревожное расстройство" },
  { icd10Code: "F32.1", label: "Депрессивный эпизод умеренной степени" },
  { icd10Code: "G62.9", label: "Полинейропатия неуточнённая" },
  { icd10Code: "M42.1", label: "Юношеский остеохондроз позвоночника" },
  { icd10Code: "G40.3", label: "Эпилепсия (генерализованная)" },
  { icd10Code: "H81.0", label: "Болезнь Меньера" },
  { icd10Code: "G50.0", label: "Невралгия тройничного нерва" },
] as const;

const COMPLAINTS_NEURO = [
  "Головная боль", "Головокружение", "Бессонница",
  "Онемение конечностей", "Снижение памяти", "Раздражительность",
  "Шум в ушах", "Боль в шее", "Тревога", "Слабость в руке",
];
const COMPLAINTS_CARDIO = [
  "Боль в груди", "Одышка при физической нагрузке", "Сердцебиение",
  "Повышение АД", "Отёки нижних конечностей", "Перебои в работе сердца",
];
const COMPLAINTS_PED = [
  "Беспокойный сон", "Задержка речевого развития", "Повышенный тонус",
  "Капризность", "Плохой аппетит", "Частые срыгивания",
];

const ANAMNESIS_POOL = [
  "Симптомы беспокоят около 2 недель, нарастают к вечеру",
  "Хронически — несколько лет, обостряется на фоне стресса",
  "Эпизодически — раз в 1–2 месяца",
  "Впервые возникло на прошлой неделе",
  "После перенесённой ОРВИ месяц назад",
  "На фоне повышенной нагрузки на работе",
  "Семейный анамнез отягощён (мать, бабушка)",
  "Связывает с переменой погоды",
];

const EXAM_NEURO = [
  "Сознание ясное, ориентирован",
  "ЧМН без патологии",
  "Сухожильные рефлексы D=S, живые",
  "Парезов нет",
  "Координаторные пробы выполняет удовлетворительно",
  "Менингеальной симптоматики нет",
  "Чувствительность сохранена",
  "Симптом Ласега отрицательный",
];

const PRESCRIPTIONS_NEURO = [
  "Мильгамма 2.0 в/м №10",
  "Мексидол 250 мг 2 р/д 14 дней",
  "Глицин 100 мг 3 р/д 1 мес",
  "Сирдалуд 4 мг 1 р/н 10 дней",
  "Магне B6 1 таб 2 р/д 1 мес",
  "Ноотропил 1200 мг 1 р/д 2 мес",
  "Топирамат 50 мг на ночь 3 мес",
  "Беталок ЗОК 50 мг 1 р/д утром",
];

const PRESCRIPTIONS_CARDIO = [
  "Конкор 5 мг 1 р/д утром",
  "Лозап 50 мг 1 р/д утром",
  "Аторвастатин 20 мг 1 р/н",
  "Тромбо АСС 100 мг после еды",
  "Эналаприл 10 мг 2 р/д",
];

const ADVICE_POOL = [
  "Соблюдать режим сна",
  "Снизить эмоциональные нагрузки",
  "Гипонатриевая диета",
  "Контроль АД утром и вечером",
  "Ограничить кофе, крепкий чай",
  "Регулярные пешие прогулки",
  "Контроль через 2 недели",
  "Контроль ОАК через 1 месяц",
  "При ухудшении — приём вне очереди",
];

const SOAP_BODY_TEMPLATES = [
  (compl: string, dx: string, rx: string[], adv: string[]) =>
    `## Жалобы\n${compl}.\n\n## Анамнез\nБолен(а) около ${rndInt(1, 8)} ${rndInt(1, 8) > 1 ? "недель" : "недели"}. Ранее не обследовался. Без сопутствующих обострений.\n\n## Объективно\nСостояние удовлетворительное. АД ${rndInt(110, 145)}/${rndInt(70, 95)} мм рт ст. ЧСС ${rndInt(64, 92)} в мин., ритмичный.\n\n## Диагноз\n${dx}\n\n## Назначения\n${rx.map((r) => `- ${r}`).join("\n")}\n\n## Рекомендации\n${adv.map((a) => `- ${a}`).join("\n")}\n\n_${TAG_ULTRA}_`,
  (compl: string, dx: string, rx: string[], adv: string[]) =>
    `## Жалобы\n${compl}.\n\n## История заболевания\nЖалобы появились после физической нагрузки, нарастали постепенно. Предыдущая терапия частично эффективна.\n\n## Status localis\nКожные покровы обычной окраски. Видимые слизистые чистые. Лимфоузлы не увеличены. АД ${rndInt(110, 150)}/${rndInt(70, 95)}. ЧСС ${rndInt(60, 95)}.\n\n## Заключение\n${dx}\n\n## План\n${rx.map((r) => `1. ${r}`).join("\n")}\n\n## Беседа с пациентом\n${adv.map((a) => `- ${a}`).join("\n")}\n\n_${TAG_ULTRA}_`,
];

const LAB_PANELS: { code: string; tests: { name: string; unit: string; range: string; lo: number; hi: number; critLo: number; critHi: number }[] }[] = [
  {
    code: "CBC",
    tests: [
      { name: "Гемоглобин", unit: "г/л", range: "120-160", lo: 120, hi: 160, critLo: 70, critHi: 210 },
      { name: "Эритроциты", unit: "×10¹²/л", range: "4.0-5.5", lo: 4.0, hi: 5.5, critLo: 2.5, critHi: 7.0 },
      { name: "Лейкоциты", unit: "×10⁹/л", range: "4.0-9.0", lo: 4.0, hi: 9.0, critLo: 1.5, critHi: 30 },
      { name: "Тромбоциты", unit: "×10⁹/л", range: "180-360", lo: 180, hi: 360, critLo: 50, critHi: 800 },
      { name: "СОЭ", unit: "мм/ч", range: "2-20", lo: 2, hi: 20, critLo: 0, critHi: 80 },
    ],
  },
  {
    code: "BIOCHEM",
    tests: [
      { name: "Глюкоза", unit: "ммоль/л", range: "3.3-5.5", lo: 3.3, hi: 5.5, critLo: 2.0, critHi: 18 },
      { name: "Креатинин", unit: "мкмоль/л", range: "62-115", lo: 62, hi: 115, critLo: 30, critHi: 600 },
      { name: "АЛТ", unit: "Ед/л", range: "0-41", lo: 0, hi: 41, critLo: 0, critHi: 400 },
      { name: "АСТ", unit: "Ед/л", range: "0-40", lo: 0, hi: 40, critLo: 0, critHi: 400 },
      { name: "Холестерин общий", unit: "ммоль/л", range: "3.0-5.2", lo: 3.0, hi: 5.2, critLo: 2.0, critHi: 11 },
    ],
  },
  {
    code: "LIPID",
    tests: [
      { name: "ЛПНП", unit: "ммоль/л", range: "<3.0", lo: 0, hi: 3.0, critLo: 0, critHi: 8 },
      { name: "ЛПВП", unit: "ммоль/л", range: "1.0-1.8", lo: 1.0, hi: 1.8, critLo: 0.5, critHi: 5 },
      { name: "Триглицериды", unit: "ммоль/л", range: "0.4-1.7", lo: 0.4, hi: 1.7, critLo: 0.1, critHi: 6 },
    ],
  },
  {
    code: "TSH",
    tests: [
      { name: "ТТГ", unit: "мЕд/л", range: "0.4-4.0", lo: 0.4, hi: 4.0, critLo: 0.05, critHi: 100 },
      { name: "Т4 свободный", unit: "пмоль/л", range: "9-22", lo: 9, hi: 22, critLo: 3, critHi: 60 },
    ],
  },
];

const DRUG_NAMES = [
  { name: "Лозап", dosage: "50 мг", times: ["08:00"] },
  { name: "Конкор", dosage: "5 мг", times: ["08:00"] },
  { name: "Аторвастатин", dosage: "20 мг", times: ["21:00"] },
  { name: "Мильгамма", dosage: "1 таб", times: ["08:00", "20:00"] },
  { name: "Мексидол", dosage: "250 мг", times: ["09:00", "21:00"] },
  { name: "Глицин", dosage: "100 мг", times: ["08:00", "13:00", "19:00"] },
  { name: "Магне B6", dosage: "1 таб", times: ["09:00", "20:00"] },
  { name: "Эналаприл", dosage: "10 мг", times: ["08:00", "20:00"] },
  { name: "Топирамат", dosage: "50 мг", times: ["22:00"] },
  { name: "Сирдалуд", dosage: "4 мг", times: ["22:00"] },
];

const REVIEWS_POOL = [
  { rating: 5, text: "Очень внимательный доктор, расписал лечение пошагово. Спасибо!" },
  { rating: 5, text: "Отличный приём, всё разъяснили. Будем рекомендовать друзьям." },
  { rating: 5, text: "Записалась через бот, всё быстро. Доктор внимательный, разобрался в моей истории." },
  { rating: 4, text: "Хорошая клиника, но ждала минут 20. Лечение помогло." },
  { rating: 5, text: "Спасибо за помощь! Головные боли почти прошли через неделю терапии." },
  { rating: 5, text: "Привезли ребёнка, доктор нашла подход. Очень довольны." },
  { rating: 4, text: "Принимают хорошо, цены адекватные. Чисто, всё стерильно." },
  { rating: 3, text: "Долго ждали в очереди, но врач очень профессиональный." },
  { rating: 5, text: "Lekin tashkilot juda yaxshi, doktorlar bolalar bilan ishlay biladi." },
  { rating: 5, text: "Ahmedov Akmal Botirovich — настоящий профессионал. Отдельное спасибо." },
];

const COMM_REMINDERS = [
  "Здравствуйте! Напоминаем о записи на завтра в {time}. Ответьте «Да» для подтверждения.",
  "Запись подтверждена. Ждём вас {date} в {time}. Адрес: ул. Бабура 12.",
  "Ваш приём через 1 час. Просьба не опаздывать.",
  "Результаты анализов готовы. Можно забрать или получить на email.",
  "Уважаемый пациент, не забудьте взять с собой паспорт и предыдущие заключения.",
];

const COMM_INBOUND = [
  "Да, подтверждаю",
  "Подтверждаю",
  "Спасибо, буду",
  "Можно перенести на пятницу?",
  "ОК",
  "Здравствуйте, можно пораньше?",
];

const REMINDERS_POOL = [
  { title: "Перезвонить пациенту по результату МРТ", body: "Уточнить готовность диска" },
  { title: "Подписать заключение", body: "До конца дня" },
  { title: "Связаться с лабораторией", body: "По поводу анализа крови" },
  { title: "Проверить результаты повторного ЭЭГ", body: null },
  { title: "Согласовать схему терапии с кардиологом", body: "По пациенту Усманов" },
  { title: "Дать обратную связь по случаю", body: "Утренний обход" },
  { title: "Распечатать рецепты на следующий приём", body: null },
  { title: "Ответить на отзыв на Яндекс.Картах", body: null },
];

// ICD-10 code+name pairs to attach to VisitNote.
const DX_BY_DOCTOR_CATEGORY: Record<string, { code: string; name: string }[]> = {
  neurology: [
    { code: "G43.0", name: "Мигрень без ауры" },
    { code: "G44.2", name: "Головная боль напряжения" },
    { code: "G47.0", name: "Бессонница" },
    { code: "G93.4", name: "Энцефалопатия неуточнённая" },
    { code: "M54.2", name: "Цервикалгия" },
  ],
  cardiology: [
    { code: "I10", name: "Эссенциальная (первичная) гипертензия" },
    { code: "I25.1", name: "Атеросклеротическая болезнь сердца" },
    { code: "I20.8", name: "Стенокардия (другие формы)" },
  ],
  pediatric: [
    { code: "G80.9", name: "ДЦП (форма не уточнена)" },
    { code: "F90.0", name: "СДВГ" },
    { code: "G47.8", name: "Нарушения сна у детей" },
  ],
};

function categorizeDoctor(specRu: string): keyof typeof DX_BY_DOCTOR_CATEGORY {
  const s = specRu.toLowerCase();
  if (s.includes("кардиолог")) return "cardiology";
  if (s.includes("педиатр") || s.includes("детск")) return "pediatric";
  return "neurology";
}

function complaintsFor(category: keyof typeof DX_BY_DOCTOR_CATEGORY): string[] {
  const pool =
    category === "cardiology"
      ? COMPLAINTS_CARDIO
      : category === "pediatric"
      ? COMPLAINTS_PED
      : COMPLAINTS_NEURO;
  const n = rndInt(1, 3);
  const out: string[] = [];
  while (out.length < n) {
    const c = pick(pool);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

function pickN<T>(arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(rndInt(0, pool.length - 1), 1)[0]!);
  }
  return out;
}

function labValue(t: typeof LAB_PANELS[number]["tests"][number]): {
  value: string;
  flag: "NORMAL" | "LOW" | "HIGH" | "CRITICAL";
} {
  // 75% normal, 15% mild abnormal, 8% high/low, 2% critical
  const r = Math.random();
  let v: number;
  let flag: "NORMAL" | "LOW" | "HIGH" | "CRITICAL" = "NORMAL";
  if (r < 0.75) {
    v = +(t.lo + Math.random() * (t.hi - t.lo)).toFixed(2);
  } else if (r < 0.9) {
    if (Math.random() < 0.5) {
      v = +(t.lo - Math.random() * (t.lo * 0.2)).toFixed(2);
      flag = "LOW";
    } else {
      v = +(t.hi + Math.random() * (t.hi * 0.3)).toFixed(2);
      flag = "HIGH";
    }
  } else if (r < 0.98) {
    if (Math.random() < 0.5) {
      v = +(t.lo - Math.random() * (t.lo * 0.4)).toFixed(2);
      flag = "LOW";
    } else {
      v = +(t.hi + Math.random() * (t.hi * 0.8)).toFixed(2);
      flag = "HIGH";
    }
  } else {
    if (Math.random() < 0.5) {
      v = t.critLo;
      flag = "CRITICAL";
    } else {
      v = t.critHi;
      flag = "CRITICAL";
    }
  }
  if (v < 0) v = 0;
  return { value: String(v), flag };
}

// ─── Idempotent wipe ────────────────────────────────────────────────────

async function wipeUltra(clinicId: string): Promise<void> {
  // Wipe ultra-tagged rows from a previous run.
  await prisma.medicationReminderSend.deleteMany({
    where: { clinic: { id: clinicId }, notes: { contains: TAG_ULTRA } },
  });
  await prisma.prescription.deleteMany({
    where: { clinicId, notes: { contains: TAG_ULTRA } },
  });
  await prisma.ePrescription.deleteMany({
    where: { clinicId, notes: { contains: TAG_ULTRA } },
  });
  await prisma.labResult.deleteMany({
    where: { clinicId, notes: { contains: TAG_ULTRA } },
  });
  await prisma.labOrder.deleteMany({
    where: { clinicId, notes: { contains: TAG_ULTRA } },
  });
  await prisma.visitNote.deleteMany({
    where: { clinicId, bodyMarkdown: { contains: TAG_ULTRA } },
  });
  await prisma.medicalCase.deleteMany({
    where: { clinicId, notes: { contains: TAG_ULTRA } },
  });
  // Demo patients keep their allergies/chronic/diagnoses if we re-tag, so
  // wipe everything tied to demo patients first (clean slate).
  const demoIds = (
    await prisma.patient.findMany({
      where: { clinicId, tags: { has: TAG_DEMO } },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (demoIds.length > 0) {
    await prisma.patientAllergy.deleteMany({ where: { patientId: { in: demoIds } } });
    await prisma.patientChronicCondition.deleteMany({ where: { patientId: { in: demoIds } } });
    await prisma.patientDiagnosis.deleteMany({ where: { patientId: { in: demoIds } } });
  }
  await prisma.review.deleteMany({
    where: { clinicId, text: { contains: TAG_ULTRA } },
  });
  await prisma.communication.deleteMany({
    where: {
      clinicId,
      meta: { path: ["seed"], equals: "ultra" },
    },
  });
  await prisma.reminder.deleteMany({
    where: { clinicId, body: { contains: TAG_ULTRA } },
  });
  await prisma.auditLog.deleteMany({
    where: { clinicId, meta: { path: ["seed"], equals: "ultra" } },
  });
}

// ─── Seeders ────────────────────────────────────────────────────────────

async function seedMedicalHistory(
  clinicId: string,
  patients: { id: string }[],
): Promise<{ allergies: number; chronic: number; diagnoses: number }> {
  let allergies = 0,
    chronic = 0,
    diagnoses = 0;
  for (const p of patients) {
    if (chance(0.55)) {
      const n = rndInt(1, 3);
      for (let i = 0; i < n; i++) {
        const a = pick(ALLERGIES);
        await prisma.patientAllergy.create({
          data: {
            clinicId,
            patientId: p.id,
            substance: a.substance,
            reaction: a.reaction,
            severity: a.severity,
            notes: chance(0.3) ? `Замечена с детства. ${TAG_ULTRA}` : null,
            recordedAt: daysAgo(rndInt(30, 1500)),
          },
        });
        allergies++;
      }
    }
    if (chance(0.4)) {
      const n = rndInt(1, 2);
      for (let i = 0; i < n; i++) {
        await prisma.patientChronicCondition.create({
          data: {
            clinicId,
            patientId: p.id,
            name: pick(CHRONIC),
            sinceDate: daysAgo(rndInt(180, 2000)),
            notes: chance(0.4) ? `Под контролем терапевта. ${TAG_ULTRA}` : null,
            isActive: chance(0.92),
          },
        });
        chronic++;
      }
    }
    if (chance(0.65)) {
      const n = rndInt(1, 3);
      for (let i = 0; i < n; i++) {
        const dx = pick(DIAGNOSES);
        await prisma.patientDiagnosis.create({
          data: {
            clinicId,
            patientId: p.id,
            icd10Code: dx.icd10Code,
            label: dx.label,
            diagnosedAt: daysAgo(rndInt(7, 720)),
            notes: chance(0.25) ? `Под наблюдением. ${TAG_ULTRA}` : null,
            status: chance(0.78) ? "ACTIVE" : "RESOLVED",
          },
        });
        diagnoses++;
      }
    }
  }
  return { allergies, chronic, diagnoses };
}

async function seedVisitNotesAndLabs(
  clinicId: string,
  doctors: {
    id: string;
    userId: string | null;
    nameRu: string;
    specializationRu: string;
  }[],
): Promise<{
  visitNotes: number;
  labOrders: number;
  labResults: number;
  ePrescriptions: number;
}> {
  // Pull completed appointments for demo patients only — we want clinical
  // depth on the showcase clinic, not on every leftover row.
  const completed = await prisma.appointment.findMany({
    where: {
      clinicId,
      status: "COMPLETED",
      patient: { tags: { has: TAG_DEMO } },
    },
    select: {
      id: true,
      patientId: true,
      doctorId: true,
      date: true,
      durationMin: true,
    },
    take: 800,
    orderBy: { date: "desc" },
  });

  const doctorById = new Map(doctors.map((d) => [d.id, d]));
  let vnCount = 0,
    loCount = 0,
    lrCount = 0,
    rxCount = 0;

  // LabOrder.orderNumber must be globally unique. Find current max suffix
  // for today so re-running doesn't collide.
  let orderSeq = (await prisma.labOrder.count()) + 1;

  for (const appt of completed) {
    const doc = doctorById.get(appt.doctorId);
    if (!doc) continue;
    const category = categorizeDoctor(doc.specializationRu);
    const dx = pick(DX_BY_DOCTOR_CATEGORY[category]);
    const complaints = complaintsFor(category);
    const anam = pickN(ANAMNESIS_POOL, rndInt(1, 3));
    const exam = pickN(EXAM_NEURO, rndInt(2, 4));
    const rxList =
      category === "cardiology"
        ? pickN(PRESCRIPTIONS_CARDIO, rndInt(1, 3))
        : pickN(PRESCRIPTIONS_NEURO, rndInt(1, 4));
    const advice = pickN(ADVICE_POOL, rndInt(2, 4));
    const tmpl = pick(SOAP_BODY_TEMPLATES);
    const body = tmpl(complaints.join(", "), `${dx.code} — ${dx.name}`, rxList, advice);

    // VisitNote (1 per appointment, unique constraint).
    let vn;
    try {
      vn = await prisma.visitNote.create({
        data: {
          clinicId,
          appointmentId: appt.id,
          patientId: appt.patientId,
          doctorId: appt.doctorId,
          status: "FINALIZED",
          startedAt: appt.date,
          finalizedAt: new Date(appt.date.getTime() + appt.durationMin * 60_000),
          complaints,
          anamnesis: anam,
          examination: exam,
          prescriptions: rxList,
          advice,
          diagnosisCode: dx.code,
          diagnosisName: dx.name,
          bodyMarkdown: body,
          aiGenerated: false,
        },
        select: { id: true },
      });
      vnCount++;
    } catch {
      // appointmentId is @unique — if a note already exists (e.g. from
      // an earlier non-ultra run), skip rather than fail.
      continue;
    }

    // LabOrder + LabResults for ~35% of visits.
    if (chance(0.35) && doc.userId) {
      const panel = pick(LAB_PANELS);
      const stamp = new Date(appt.date);
      const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}`;
      const orderNumber = `LO-${ymd}-${String(orderSeq++).padStart(4, "0")}`;
      const order = await prisma.labOrder.create({
        data: {
          clinicId,
          orderNumber,
          patientId: appt.patientId,
          doctorId: doc.userId,
          appointmentId: appt.id,
          visitNoteId: vn.id,
          testCodes: panel.tests.map((t) => t.name),
          panelCodes: [panel.code],
          diagnosisCode: dx.code,
          notes: `${TAG_ULTRA} Назначения от приёма ${stamp.toLocaleDateString("ru-RU")}`,
          urgency: chance(0.1) ? "URGENT" : "ROUTINE",
          status: "COMPLETED",
          printedAt: stamp,
          createdAt: stamp,
        },
        select: { id: true },
      });
      loCount++;
      const resultedAt = new Date(stamp.getTime() + rndInt(2, 48) * 3_600_000);
      for (const test of panel.tests) {
        const { value, flag } = labValue(test);
        await prisma.labResult.create({
          data: {
            clinicId,
            patientId: appt.patientId,
            doctorId: doc.userId,
            appointmentId: appt.id,
            visitNoteId: vn.id,
            testName: test.name,
            value,
            unit: test.unit,
            refRange: test.range,
            flag,
            notes: flag === "CRITICAL" ? `${TAG_ULTRA} Срочно — критическое отклонение` : `${TAG_ULTRA}`,
            status: chance(0.8) ? "REVIEWED" : "RESULTED",
            receivedAt: resultedAt,
            reviewedAt: chance(0.8) ? new Date(resultedAt.getTime() + rndInt(1, 6) * 3_600_000) : null,
            reviewedBy: chance(0.8) ? doc.userId : null,
            createdAt: resultedAt,
          },
        });
        lrCount++;
      }
    }

    // EPrescription for ~45% of visits.
    if (chance(0.45) && doc.userId && rxList.length > 0) {
      const stamp = new Date(appt.date);
      const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}`;
      const items = rxList.map((line) => {
        const m = /^(\S+)\s+(.+?)\s+(\d+\s*р\/[днс].*|после|на ночь|утром).*$/.exec(line);
        return {
          drugName: m?.[1] ?? line,
          dose: m?.[2] ?? "",
          frequency: m?.[3] ?? "",
          instructions: line,
        };
      });
      await prisma.ePrescription.create({
        data: {
          clinicId,
          rxNumber: `RX-${ymd}-${String(rxCount + 1).padStart(4, "0")}`,
          verifyToken: `vtok_${appt.id.slice(-12)}_${rxCount}`,
          patientId: appt.patientId,
          doctorId: doc.userId,
          appointmentId: appt.id,
          visitNoteId: vn.id,
          diagnosisCode: dx.code,
          diagnosisName: dx.name,
          items,
          notes: `${TAG_ULTRA} Выдано по итогам приёма`,
          issuedAt: stamp,
          validUntilAt: new Date(stamp.getTime() + 30 * 24 * 3_600_000),
          status: "ISSUED",
          createdAt: stamp,
        },
      });
      rxCount++;
    }
  }
  return { visitNotes: vnCount, labOrders: loCount, labResults: lrCount, ePrescriptions: rxCount };
}

async function seedMedicalCases(
  clinicId: string,
  patients: { id: string }[],
  doctors: { id: string }[],
): Promise<{ cases: number; prescriptions: number; reminderSends: number }> {
  let cases = 0,
    rxs = 0,
    sends = 0;

  // ~25% of patients get a MedicalCase grouping their visits.
  const subset = patients.filter(() => chance(0.25));
  for (const p of subset) {
    const visits = await prisma.appointment.findMany({
      where: { clinicId, patientId: p.id, status: "COMPLETED" },
      select: { id: true, doctorId: true, date: true },
      orderBy: { date: "asc" },
      take: 5,
    });
    if (visits.length === 0) continue;
    const primaryDoctor = visits[0]!.doctorId;
    const dx = pick(DIAGNOSES);
    const mc = await prisma.medicalCase.create({
      data: {
        clinicId,
        patientId: p.id,
        primaryDoctorId: primaryDoctor,
        title: `Эпизод: ${dx.label}`,
        primaryComplaint: pick(COMPLAINTS_NEURO) + ", " + pick(COMPLAINTS_NEURO),
        diagnosisText: dx.label,
        diagnosisCode: dx.icd10Code,
        notes: `${TAG_ULTRA} Сгруппирован для отслеживания случая`,
        status: chance(0.65) ? "OPEN" : "RESOLVED",
        openedAt: visits[0]!.date,
        closedAt: chance(0.35) ? visits[visits.length - 1]!.date : null,
        closedReason: chance(0.35) ? "Полное выздоровление" : null,
      },
      select: { id: true },
    });
    // Attach visits to case
    await prisma.appointment.updateMany({
      where: { id: { in: visits.map((v) => v.id) } },
      data: { medicalCaseId: mc.id },
    });
    cases++;

    // Prescription tied to this case
    if (chance(0.8)) {
      const drug = pick(DRUG_NAMES);
      const rxStartAt = new Date(visits[0]!.date.getTime() + 60_000);
      const rx = await prisma.prescription.create({
        data: {
          clinicId,
          caseId: mc.id,
          patientId: p.id,
          doctorId: primaryDoctor,
          drugName: drug.name,
          dosage: drug.dosage,
          schedule: {
            times: drug.times,
            days: rndInt(14, 90),
            startsAt: rxStartAt.toISOString(),
          },
          notes: `${TAG_ULTRA} Принимать после еды`,
          status: chance(0.7) ? "ACTIVE" : "COMPLETED",
          remindersEnabled: chance(0.55),
          createdAt: rxStartAt,
        },
        select: { id: true, remindersEnabled: true, status: true },
      });
      rxs++;

      // Medication reminder sends for next 2 days, hourly grain.
      if (rx.remindersEnabled && rx.status === "ACTIVE") {
        for (let day = 0; day < 2; day++) {
          for (const time of drug.times) {
            const [h, m] = time.split(":").map(Number);
            const sched = new Date();
            sched.setDate(sched.getDate() + day);
            sched.setHours(h ?? 8, m ?? 0, 0, 0);
            const isPast = sched.getTime() < Date.now();
            const status = isPast
              ? pick(["TAKEN", "TAKEN", "TAKEN", "SKIPPED", "EXPIRED"])
              : "PENDING";
            try {
              await prisma.medicationReminderSend.create({
                data: {
                  clinicId,
                  prescriptionId: rx.id,
                  patientId: p.id,
                  scheduledFor: sched,
                  sentAt: isPast ? sched : null,
                  status,
                  respondedAt: isPast && status !== "EXPIRED" ? new Date(sched.getTime() + rndInt(5, 60) * 60_000) : null,
                  notes: `${TAG_ULTRA}`,
                },
              });
              sends++;
            } catch {
              // unique(prescriptionId, scheduledFor) — skip dupe
            }
          }
        }
      }
    }
  }
  return { cases, prescriptions: rxs, reminderSends: sends };
}

async function seedReviews(clinicId: string, patients: { id: string }[]): Promise<number> {
  let n = 0;
  const COUNT = 45;
  for (let i = 0; i < COUNT; i++) {
    const r = pick(REVIEWS_POOL);
    const linked = chance(0.55) ? patients[rndInt(0, patients.length - 1)] : null;
    await prisma.review.create({
      data: {
        clinicId,
        patientId: linked?.id ?? null,
        authorName: linked ? `Пациент #${i + 1}` : pick(["Анонимно", "Гость", "Аноним"]),
        rating: r.rating,
        text: `${r.text} ${TAG_ULTRA}`,
        source: pick(["yandex", "google", "telegram", "patient_portal"]),
        sourceUrl: chance(0.4) ? "https://yandex.uz/maps/reviews/neurofax" : null,
        publishedAt: daysAgo(rndInt(1, 200)),
        visible: chance(0.95),
      },
    });
    n++;
  }
  return n;
}

async function seedCommunications(
  clinicId: string,
  patients: { id: string; fullName: string; phone: string | null }[],
): Promise<number> {
  // Outbound SMS audit trail spread over the last 90 days. These are the
  // "logged" sends — Conversation/Message thread separately.
  let n = 0;
  for (let day = 90; day >= 0; day--) {
    const dailyCount = day === 0 ? rndInt(8, 18) : rndInt(2, 10);
    for (let i = 0; i < dailyCount; i++) {
      const p = pick(patients);
      const hour = rndInt(8, 19);
      const min = rndInt(0, 59);
      const sentAt = new Date();
      sentAt.setDate(sentAt.getDate() - day);
      sentAt.setHours(hour, min, 0, 0);
      const tpl = pick(COMM_REMINDERS).replace("{time}", `${rndInt(9, 18)}:${rndInt(0, 1) === 0 ? "00" : "30"}`).replace("{date}", sentAt.toLocaleDateString("ru-RU"));
      await prisma.communication.create({
        data: {
          clinicId,
          patientId: p.id,
          channel: "SMS",
          direction: "OUT",
          body: tpl,
          meta: {
            seed: "ultra",
            phone: p.phone,
            adapter: "LogOnly",
            real: false,
            status: chance(0.92) ? "SENT" : "FAILED",
          },
          createdAt: sentAt,
        },
      });
      n++;
      // Inbound reply ~30% of the time
      if (chance(0.3)) {
        const replyAt = new Date(sentAt.getTime() + rndInt(2, 240) * 60_000);
        await prisma.communication.create({
          data: {
            clinicId,
            patientId: p.id,
            channel: "SMS",
            direction: "IN",
            body: pick(COMM_INBOUND),
            meta: { seed: "ultra", phone: p.phone },
            createdAt: replyAt,
          },
        });
        n++;
      }
    }
  }
  return n;
}

async function seedReminders(
  clinicId: string,
  doctorUsers: { userId: string }[],
  patients: { id: string }[],
): Promise<number> {
  if (doctorUsers.length === 0) return 0;
  let n = 0;
  for (const du of doctorUsers) {
    const count = rndInt(3, 7);
    for (let i = 0; i < count; i++) {
      const r = pick(REMINDERS_POOL);
      // Distribution: 30% due today (My Day), 40% due in next 3 days, 30% past
      const roll = Math.random();
      let remindAt: Date;
      let status: "PENDING" | "DONE" | "DISMISSED";
      if (roll < 0.3) {
        remindAt = minutesFromNow(rndInt(-60, 360));
        status = "PENDING";
      } else if (roll < 0.7) {
        remindAt = minutesFromNow(rndInt(60 * 24, 60 * 24 * 3));
        status = "PENDING";
      } else {
        remindAt = hoursAgo(rndInt(6, 240));
        status = chance(0.7) ? "DONE" : "DISMISSED";
      }
      const patient = chance(0.65) ? pick(patients) : null;
      await prisma.reminder.create({
        data: {
          clinicId,
          doctorId: du.userId,
          patientId: patient?.id ?? null,
          title: r.title,
          body: `${r.body ?? "—"} ${TAG_ULTRA}`,
          remindAt,
          status,
          completedAt: status === "DONE" ? new Date(remindAt.getTime() + rndInt(10, 720) * 60_000) : null,
        },
      });
      n++;
    }
  }
  return n;
}

async function seedAuditLog(
  clinicId: string,
  doctorUsers: { userId: string }[],
  patients: { id: string }[],
): Promise<number> {
  // 1500 audit rows scattered across the past 365 days. Action mix mirrors
  // what a real working clinic would emit.
  const TOTAL = 1500;
  const actions = [
    { action: "user.signin", entityType: "User", weight: 25 },
    { action: "appointment.create", entityType: "Appointment", weight: 20 },
    { action: "appointment.update", entityType: "Appointment", weight: 15 },
    { action: "appointment.complete", entityType: "Appointment", weight: 12 },
    { action: "payment.create", entityType: "Payment", weight: 10 },
    { action: "document.upload", entityType: "Document", weight: 5 },
    { action: "communication.sms.send", entityType: "Communication", weight: 5 },
    { action: "visitnote.finalize", entityType: "VisitNote", weight: 4 },
    { action: "patient.update", entityType: "Patient", weight: 3 },
    { action: "lab.result.review", entityType: "LabResult", weight: 1 },
  ];
  const total = actions.reduce((s, a) => s + a.weight, 0);
  let n = 0;
  for (let i = 0; i < TOTAL; i++) {
    let r = rndInt(0, total - 1);
    let pickAction = actions[0]!;
    for (const a of actions) {
      if (r < a.weight) {
        pickAction = a;
        break;
      }
      r -= a.weight;
    }
    const actor = doctorUsers.length > 0 ? pick(doctorUsers) : null;
    const daysBack = Math.floor(Math.pow(Math.random(), 0.5) * 365);
    const hour = rndInt(8, 19);
    const min = rndInt(0, 59);
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - daysBack);
    createdAt.setHours(hour, min, 0, 0);
    await prisma.auditLog.create({
      data: {
        clinicId,
        actorId: actor?.userId ?? null,
        actorRole: chance(0.6) ? "DOCTOR" : pick(["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"]),
        actorLabel: actor ? `User#${actor.userId.slice(-6)}` : "System",
        action: pickAction.action,
        entityType: pickAction.entityType,
        entityId: chance(0.7) && patients.length > 0 ? pick(patients).id : null,
        meta: { seed: "ultra", iter: i },
        ip: `192.168.${rndInt(1, 50)}.${rndInt(1, 250)}`,
        userAgent: pick([
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X)",
          "MedBook/Telegram-MiniApp",
        ]),
        createdAt,
      },
    });
    n++;
  }
  return n;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const clinic = await prisma.clinic.findFirst({
    where: { slug: SLUG },
    select: { id: true, nameRu: true },
  });
  if (!clinic) {
    console.error(`clinic "${SLUG}" not found`);
    process.exit(1);
  }
  const clinicId = clinic.id;
  console.log(`=== seed-clinical-life ===`);
  console.log(`clinic: ${clinic.nameRu} (${clinicId})`);

  console.log(`→ wiping previous ultra rows…`);
  await wipeUltra(clinicId);

  const [doctors, demoPatients] = await Promise.all([
    prisma.doctor.findMany({
      where: { clinicId, isActive: true },
      select: {
        id: true,
        userId: true,
        nameRu: true,
        specializationRu: true,
      },
    }),
    prisma.patient.findMany({
      where: { clinicId, tags: { has: TAG_DEMO } },
      select: { id: true, fullName: true, phone: true },
    }),
  ]);
  console.log(`  doctors=${doctors.length} demoPatients=${demoPatients.length}`);
  const doctorUsers = doctors
    .filter((d): d is typeof d & { userId: string } => !!d.userId)
    .map((d) => ({ userId: d.userId }));

  console.log(`→ medical history (allergies/chronic/diagnoses)…`);
  const hist = await seedMedicalHistory(clinicId, demoPatients);
  console.log(`  +${hist.allergies} allergies · +${hist.chronic} chronic · +${hist.diagnoses} diagnoses`);

  console.log(`→ visit notes + lab orders/results + e-prescriptions…`);
  const vn = await seedVisitNotesAndLabs(clinicId, doctors);
  console.log(
    `  +${vn.visitNotes} visit notes · +${vn.labOrders} lab orders · +${vn.labResults} lab results · +${vn.ePrescriptions} e-prescriptions`,
  );

  console.log(`→ medical cases + prescriptions + medication reminders…`);
  const mc = await seedMedicalCases(clinicId, demoPatients, doctors);
  console.log(`  +${mc.cases} cases · +${mc.prescriptions} prescriptions · +${mc.reminderSends} medication reminders`);

  console.log(`→ reviews…`);
  const reviewsCount = await seedReviews(clinicId, demoPatients);
  console.log(`  +${reviewsCount} reviews`);

  console.log(`→ communication audit trail (90 days)…`);
  const commCount = await seedCommunications(clinicId, demoPatients);
  console.log(`  +${commCount} communications`);

  console.log(`→ doctor reminders (My Day)…`);
  const remCount = await seedReminders(clinicId, doctorUsers, demoPatients);
  console.log(`  +${remCount} reminders`);

  console.log(`→ audit log (1 year)…`);
  const auditCount = await seedAuditLog(clinicId, doctorUsers, demoPatients);
  console.log(`  +${auditCount} audit rows`);

  console.log("");
  console.log("✅ done");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
