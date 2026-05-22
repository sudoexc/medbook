/**
 * Clinical enrichment for the static drug catalog in `src/lib/catalogs/drugs.ts`.
 *
 * Keyed by `Drug.id` from the static catalog. The seed script merges these
 * fields with the base record (forms, names, brands) and writes them into
 * the `Drug` / `DrugBrand` tables.
 *
 * Values reflect commonly cited Russian/UZ clinical practice and standard
 * references (RLS, BNF). They're a sensible default for the prescription UI
 * — clinicians can always override. Not a substitute for primary literature.
 */
import type { DrugCategory, PregnancyCategory } from "../src/generated/prisma/client";

export type DrugEnrichment = {
  /** ATC code (WHO classification). */
  atcCode?: string;
  /** ICD-10 prefixes — drives diagnosis-driven suggestion (Phase G2). */
  indications?: string[];
  /** Plain-RU bullets, one per array slot. */
  contraindications?: string[];
  sideEffects?: string[];
  pregnancyCat?: PregnancyCategory;
  /** Adult / pediatric / renal dose copy — JSON shape kept flexible. */
  defaultDosing?: {
    adult?: string;
    pediatric?: string;
    renal?: string;
    elderly?: string;
  };
  /** Override the inferred enum from the static catalog (rarely needed). */
  categoryOverride?: DrugCategory;
  /** OTC drugs flip this off. */
  rxOnly?: boolean;
};

export const DRUG_ENRICHMENT: Record<string, DrugEnrichment> = {
  // ─── Antibiotics ────────────────────────────────────────────
  amoxicillin: {
    atcCode: "J01CA04",
    indications: ["J01", "J02", "J03", "J04", "J06", "J18", "L03", "N30", "K05"],
    contraindications: [
      "Гиперчувствительность к пенициллинам и цефалоспоринам",
      "Инфекционный мононуклеоз (риск сыпи)",
      "Тяжёлая печёночная недостаточность",
    ],
    sideEffects: ["Кожная сыпь", "Диарея", "Тошнота", "Кандидоз слизистых"],
    pregnancyCat: "B",
    defaultDosing: {
      adult: "По 500 мг 3 раза в день, 7–10 дней",
      pediatric: "20–40 мг/кг/сут в 3 приёма",
    },
  },
  amoxiclav: {
    atcCode: "J01CR02",
    indications: ["J01", "J02", "J03", "J18", "L03", "N30", "N39"],
    contraindications: [
      "Гиперчувствительность к β-лактамам",
      "Холестатическая желтуха или печёночная дисфункция в анамнезе при приёме клавуланата",
      "Инфекционный мононуклеоз",
    ],
    sideEffects: ["Диарея (часто)", "Тошнота, рвота", "Сыпь", "Кандидоз", "Холестаз"],
    pregnancyCat: "B",
    defaultDosing: {
      adult: "По 625 мг 3 раза в день, 7–10 дней",
      pediatric: "25–45 мг/кг/сут амоксициллина в 2 приёма",
    },
  },
  azithromycin: {
    atcCode: "J01FA10",
    indications: ["J01", "J02", "J03", "J04", "J06", "J18", "A56", "L03"],
    contraindications: [
      "Гиперчувствительность к макролидам",
      "Тяжёлая печёночная недостаточность",
      "Удлинение интервала QT, аритмии",
    ],
    sideEffects: ["Диарея", "Боль в животе", "Тошнота", "Удлинение QT", "Гепатотоксичность"],
    pregnancyCat: "B",
    defaultDosing: {
      adult: "По 500 мг 1 раз в день, 3 дня",
      pediatric: "10 мг/кг 1 раз в день, 3 дня",
    },
  },
  ciprofloxacin: {
    atcCode: "J01MA02",
    indications: ["N30", "N39", "A09", "J15", "H66", "L03"],
    contraindications: [
      "Возраст до 18 лет (риск артропатии)",
      "Беременность, лактация",
      "Эпилепсия, судороги в анамнезе",
      "Удлинение QT",
    ],
    sideEffects: ["Тошнота", "Тендиниты, разрыв сухожилий", "Удлинение QT", "Фотосенсибилизация"],
    pregnancyCat: "C",
    defaultDosing: { adult: "По 500 мг 2 раза в день, 7–14 дней" },
  },
  ceftriaxone: {
    atcCode: "J01DD04",
    indications: ["G00", "J18", "N10", "A40", "A41", "K65"],
    contraindications: [
      "Гиперчувствительность к цефалоспоринам и пенициллинам",
      "Новорождённые с гипербилирубинемией (риск ядерной желтухи)",
      "Одновременное в/в введение с растворами кальция у новорождённых",
    ],
    sideEffects: ["Боль в месте инъекции", "Диарея", "Эозинофилия", "Псевдомембранозный колит"],
    pregnancyCat: "B",
    defaultDosing: {
      adult: "1–2 г 1 раз в день в/м или в/в, 7–14 дней",
      pediatric: "50–80 мг/кг 1 раз в день в/м",
    },
  },
  cefixime: {
    atcCode: "J01DD08",
    indications: ["J01", "J02", "J03", "N30", "N39", "A54"],
    contraindications: [
      "Гиперчувствительность к цефалоспоринам и пенициллинам",
      "Возраст до 6 месяцев для капсул",
    ],
    sideEffects: ["Диарея", "Тошнота", "Сыпь", "Эозинофилия"],
    pregnancyCat: "B",
    defaultDosing: {
      adult: "По 400 мг 1 раз в день, 7–10 дней",
      pediatric: "8 мг/кг 1 раз в день",
    },
  },
  doxycycline: {
    atcCode: "J01AA02",
    indications: ["A77", "A69", "A56", "J18", "L70", "L71"],
    contraindications: [
      "Беременность (2–3 триместр), лактация",
      "Возраст до 8 лет",
      "Тяжёлая печёночная недостаточность",
      "Порфирия",
    ],
    sideEffects: ["Фотосенсибилизация", "Эзофагит", "Тошнота", "Окрашивание зубов у детей"],
    pregnancyCat: "D",
    defaultDosing: { adult: "В 1-й день 200 мг, затем по 100 мг 1 раз в день, 7–14 дней" },
  },
  metronidazole: {
    atcCode: "J01XD01",
    indications: ["A07.1", "K65", "N76", "K83", "A06"],
    contraindications: [
      "1 триместр беременности",
      "Лактация",
      "Тяжёлая печёночная недостаточность",
      "Неврологические заболевания",
      "Одновременный приём алкоголя",
    ],
    sideEffects: ["Металлический привкус", "Тошнота", "Периферическая нейропатия", "Дисульфирамоподобная реакция с алкоголем"],
    pregnancyCat: "B",
    defaultDosing: {
      adult: "По 500 мг 3 раза в день, 7–10 дней",
      pediatric: "20–30 мг/кг/сут в 3 приёма",
    },
  },
  clarithromycin: {
    atcCode: "J01FA09",
    indications: ["J01", "J02", "J18", "K25", "L03"],
    contraindications: [
      "Гиперчувствительность к макролидам",
      "Удлинение QT, аритмии",
      "Одновременный приём ингибиторов CYP3A4 (статинов, эрготаминов)",
    ],
    sideEffects: ["Тошнота, диарея", "Удлинение QT", "Гепатотоксичность", "Изменение вкуса"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "По 500 мг 2 раза в день, 7–14 дней",
      pediatric: "15 мг/кг/сут в 2 приёма",
    },
  },
  levofloxacin: {
    atcCode: "J01MA12",
    indications: ["J15", "J18", "N30", "N39", "L03"],
    contraindications: [
      "Возраст до 18 лет",
      "Беременность, лактация",
      "Эпилепсия",
      "Поражения сухожилий после приёма фторхинолонов в анамнезе",
    ],
    sideEffects: ["Тендинит, разрыв сухожилия", "Удлинение QT", "Диспепсия", "Фотосенсибилизация"],
    pregnancyCat: "C",
    defaultDosing: { adult: "По 500 мг 1 раз в день, 7–14 дней" },
  },

  // ─── Analgesic / Antipyretic / NSAIDs ───────────────────────
  paracetamol: {
    atcCode: "N02BE01",
    indications: ["R50", "R52", "G43", "M79"],
    contraindications: [
      "Тяжёлая печёночная недостаточность",
      "Дефицит глюкозо-6-фосфатдегидрогеназы",
      "Гиперчувствительность",
    ],
    sideEffects: ["При передозировке — гепатотоксичность", "Кожная сыпь (редко)"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "По 500–1000 мг до 4 раз в день, не более 4 г/сут",
      pediatric: "10–15 мг/кг каждые 4–6 часов, не более 60 мг/кг/сут",
    },
  },
  ibuprofen: {
    atcCode: "M01AE01",
    indications: ["R50", "R52", "M25", "G43", "M79", "K08"],
    contraindications: [
      "Язвенная болезнь в стадии обострения",
      "3 триместр беременности",
      "Тяжёлая почечная или печёночная недостаточность",
      "Бронхиальная астма с непереносимостью НПВС",
    ],
    sideEffects: ["Гастрит, язвы", "Нефротоксичность", "Бронхоспазм", "Отёки"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: {
      adult: "По 200–400 мг 3–4 раза в день, не более 1200 мг/сут",
      pediatric: "5–10 мг/кг каждые 6–8 часов",
    },
  },
  nimesulide: {
    atcCode: "M01AX17",
    indications: ["M25", "M79", "K08", "N94"],
    contraindications: [
      "Заболевания печени",
      "Возраст до 12 лет",
      "Беременность, лактация",
      "Язвенная болезнь",
    ],
    sideEffects: ["Гепатотоксичность", "Гастрит", "Кожные реакции"],
    pregnancyCat: "C",
    defaultDosing: { adult: "По 100 мг 2 раза в день после еды, курс не более 15 дней" },
  },
  diclofenac: {
    atcCode: "M01AB05",
    indications: ["M25", "M54", "M79", "M05", "M06", "N94"],
    contraindications: [
      "Язвенная болезнь",
      "3 триместр беременности",
      "Тяжёлая сердечная, печёночная или почечная недостаточность",
      "Бронхиальная астма с НПВС-непереносимостью",
    ],
    sideEffects: ["Гастропатия, язвы", "Нефро- и гепатотоксичность", "Повышение АД", "Кожные реакции"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "По 50 мг 2–3 раза в день или 75 мг в/м 1–2 раза в день, до 7 дней",
    },
  },
  ketorolac: {
    atcCode: "M01AB15",
    indications: ["R52", "M25", "M79"],
    contraindications: [
      "Язвенная болезнь",
      "Бронхиальная астма",
      "Геморрагические нарушения",
      "Беременность, лактация",
      "Возраст до 16 лет",
    ],
    sideEffects: ["Гастропатия", "Нефротоксичность", "Повышение АД"],
    pregnancyCat: "C",
    defaultDosing: { adult: "По 10 мг 4 раза в день или 30 мг в/м, курс не более 5 дней" },
  },
  aspirin: {
    atcCode: "N02BA01",
    indications: ["R50", "R52", "M79"],
    contraindications: [
      "Возраст до 15 лет (риск синдрома Рея)",
      "Язвенная болезнь",
      "Геморрагические диатезы",
      "3 триместр беременности",
    ],
    sideEffects: ["Гастропатия", "Кровотечения", "Бронхоспазм (аспириновая астма)"],
    pregnancyCat: "D",
    rxOnly: false,
    defaultDosing: { adult: "По 500 мг 2–3 раза в день" },
  },

  // ─── Antihistamines ─────────────────────────────────────────
  loratadine: {
    atcCode: "R06AX13",
    indications: ["J30", "L20", "L50"],
    contraindications: ["Гиперчувствительность", "Возраст до 2 лет"],
    sideEffects: ["Сонливость (редко)", "Сухость во рту", "Головная боль"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "По 10 мг 1 раз в день",
      pediatric: "2–12 лет: 5 мг 1 раз в день",
    },
  },
  cetirizine: {
    atcCode: "R06AE07",
    indications: ["J30", "L20", "L50"],
    contraindications: [
      "Гиперчувствительность",
      "Тяжёлая почечная недостаточность",
      "Возраст до 6 месяцев (капли)",
    ],
    sideEffects: ["Сонливость", "Сухость во рту", "Утомляемость"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "По 10 мг 1 раз в день, вечером",
      pediatric: "6–12 лет: 5 мг 2 раза в день",
    },
  },
  chloropyramine: {
    atcCode: "R06AC03",
    indications: ["J30", "L20", "L50", "T78.4"],
    contraindications: [
      "Закрытоугольная глаукома",
      "Аденома простаты с задержкой мочи",
      "Острый приступ бронхиальной астмы",
      "Беременность, лактация",
    ],
    sideEffects: ["Выраженная сонливость", "Сухость слизистых", "Задержка мочи"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "По 25 мг 3–4 раза в день или 1–2 мл в/м",
      pediatric: "От 1 мес: 6,25–12,5 мг 2–3 раза в день",
    },
  },
  desloratadine: {
    atcCode: "R06AX27",
    indications: ["J30", "L20", "L50"],
    contraindications: ["Гиперчувствительность", "Возраст до 1 года"],
    sideEffects: ["Утомляемость", "Сухость во рту", "Головная боль"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: {
      adult: "По 5 мг 1 раз в день",
      pediatric: "1–5 лет: 1,25 мг; 6–11 лет: 2,5 мг 1 раз в день",
    },
  },

  // ─── GI ─────────────────────────────────────────────────────
  omeprazole: {
    atcCode: "A02BC01",
    indications: ["K21", "K25", "K26", "K27", "K29"],
    contraindications: ["Гиперчувствительность", "Одновременный приём с нелфинавиром"],
    sideEffects: ["Головная боль", "Диарея", "Дефицит B12 при длительном приёме", "Гипомагниемия"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: {
      adult: "По 20 мг 1 раз в день утром натощак, 4–8 недель",
    },
  },
  pantoprazole: {
    atcCode: "A02BC02",
    indications: ["K21", "K25", "K26", "K29"],
    contraindications: ["Гиперчувствительность"],
    sideEffects: ["Головная боль", "Диарея", "Гипомагниемия"],
    pregnancyCat: "B",
    defaultDosing: { adult: "По 40 мг 1 раз в день утром, 4–8 недель" },
  },
  famotidine: {
    atcCode: "A02BA03",
    indications: ["K21", "K25", "K26"],
    contraindications: ["Гиперчувствительность", "Беременность, лактация"],
    sideEffects: ["Головная боль", "Запор/диарея", "Утомляемость"],
    pregnancyCat: "B",
    defaultDosing: { adult: "По 20 мг 2 раза в день или 40 мг на ночь" },
  },
  mebeverine: {
    atcCode: "A03AA04",
    indications: ["K58", "K59"],
    contraindications: ["Гиперчувствительность", "Беременность"],
    sideEffects: ["Кожные реакции (редко)", "Головокружение"],
    pregnancyCat: "C",
    defaultDosing: { adult: "По 200 мг 2 раза в день за 20 мин до еды" },
  },
  loperamide: {
    atcCode: "A07DA03",
    indications: ["K59.1", "K52"],
    contraindications: [
      "Острый колит",
      "Кишечная инфекция инвазивными возбудителями",
      "Возраст до 6 лет",
      "Беременность (1 триместр)",
    ],
    sideEffects: ["Запор", "Боль в животе", "Сонливость"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: { adult: "По 4 мг однократно, затем по 2 мг после каждого жидкого стула, макс 16 мг/сут" },
  },
  smecta: {
    atcCode: "A07BC05",
    indications: ["K59.1", "K21", "K30"],
    contraindications: ["Кишечная непроходимость", "Гиперчувствительность"],
    sideEffects: ["Запор (редко)"],
    pregnancyCat: "UNKNOWN",
    rxOnly: false,
    defaultDosing: {
      adult: "По 1 пакету 3 раза в день, растворить в 1/2 стакана воды",
      pediatric: "До 1 года: 1 пакет/сут; 1–2 года: 1–2 пакета/сут; старше 2 лет: 2–3 пакета/сут",
    },
  },
  simethicone: {
    atcCode: "A03AX13",
    indications: ["K30", "R14"],
    contraindications: ["Гиперчувствительность", "Кишечная непроходимость"],
    sideEffects: ["Аллергические реакции (редко)"],
    pregnancyCat: "UNKNOWN",
    rxOnly: false,
    defaultDosing: {
      adult: "По 2 капсулы 3–5 раз в день",
      pediatric: "Грудной возраст: 25 капель в бутылочку с молоком; 1–6 лет: 25 капель 3–5 раз в день",
    },
  },
  nifuroxazide: {
    atcCode: "A07AX03",
    indications: ["A09", "K59.1"],
    contraindications: [
      "Гиперчувствительность к нитрофуранам",
      "Возраст до 1 месяца (сироп) / до 3 лет (капсулы)",
      "Беременность",
    ],
    sideEffects: ["Аллергические реакции", "Боль в животе (редко)"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "По 200 мг 4 раза в день, 5–7 дней",
      pediatric: "От 3 лет: по 200 мг 3 раза в день",
    },
  },
  metoclopramide: {
    atcCode: "A03FA01",
    indications: ["R11", "K30", "K21"],
    contraindications: [
      "Кишечная непроходимость",
      "Феохромоцитома",
      "Эпилепсия",
      "Беременность (1 триместр)",
      "Возраст до 1 года",
    ],
    sideEffects: ["Сонливость", "Экстрапирамидные расстройства", "Поздняя дискинезия (при длительном приёме)"],
    pregnancyCat: "B",
    defaultDosing: { adult: "По 10 мг 3 раза в день до еды, курс не более 5 дней" },
  },
  domperidone: {
    atcCode: "A03FA03",
    indications: ["R11", "K30", "K21"],
    contraindications: [
      "Удлинение QT",
      "Тяжёлая печёночная недостаточность",
      "Пролактин-зависимые опухоли",
      "Желудочно-кишечное кровотечение",
    ],
    sideEffects: ["Удлинение QT", "Гиперпролактинемия (галакторея, гинекомастия)", "Сонливость"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "По 10 мг 3 раза в день до еды, курс не более 7 дней",
    },
  },

  // ─── Cardio ─────────────────────────────────────────────────
  bisoprolol: {
    atcCode: "C07AB07",
    indications: ["I10", "I20", "I25", "I50", "I47"],
    contraindications: [
      "Острая сердечная недостаточность",
      "AV-блокада 2–3 степени",
      "Брадикардия <60/мин",
      "Бронхиальная астма (тяжёлая)",
      "Шок",
    ],
    sideEffects: ["Брадикардия", "Гипотензия", "Утомляемость", "Холодные конечности", "Бронхоспазм"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "Старт 2,5 мг 1 раз в день утром, титрация до 5–10 мг",
      elderly: "Стартовая доза 1,25–2,5 мг, медленная титрация",
    },
  },
  amlodipine: {
    atcCode: "C08CA01",
    indications: ["I10", "I20", "I25"],
    contraindications: [
      "Кардиогенный шок",
      "Тяжёлая гипотензия (САД <90)",
      "Тяжёлый аортальный стеноз",
      "Нестабильная стенокардия",
    ],
    sideEffects: ["Отёки лодыжек", "Гиперемия лица", "Головная боль", "Сердцебиение"],
    pregnancyCat: "C",
    defaultDosing: { adult: "5–10 мг 1 раз в день" },
  },
  enalapril: {
    atcCode: "C09AA02",
    indications: ["I10", "I50", "N18"],
    contraindications: [
      "Беременность",
      "Ангионевротический отёк в анамнезе",
      "Двусторонний стеноз почечных артерий",
      "Гиперкалиемия",
    ],
    sideEffects: ["Сухой кашель", "Гиперкалиемия", "Гипотензия первой дозы", "Повышение креатинина"],
    pregnancyCat: "D",
    defaultDosing: {
      adult: "Старт 5 мг 1–2 раза в день, поддерживающая 10–20 мг 2 раза в день",
    },
  },
  losartan: {
    atcCode: "C09CA01",
    indications: ["I10", "I50", "N18", "E11.2"],
    contraindications: [
      "Беременность",
      "Тяжёлая печёночная недостаточность",
      "Гиперкалиемия",
      "Двусторонний стеноз почечных артерий",
    ],
    sideEffects: ["Гиперкалиемия", "Головокружение", "Гипотензия", "Утомляемость"],
    pregnancyCat: "D",
    defaultDosing: { adult: "Старт 50 мг 1 раз в день, до 100 мг" },
  },
  lisinopril: {
    atcCode: "C09AA03",
    indications: ["I10", "I50", "N18"],
    contraindications: [
      "Беременность",
      "Ангионевротический отёк в анамнезе",
      "Двусторонний стеноз почечных артерий",
    ],
    sideEffects: ["Сухой кашель", "Гиперкалиемия", "Гипотензия", "Повышение креатинина"],
    pregnancyCat: "D",
    defaultDosing: { adult: "Старт 5–10 мг 1 раз в день, до 40 мг" },
  },
  captopril: {
    atcCode: "C09AA01",
    indications: ["I10", "I50", "I21"],
    contraindications: ["Беременность", "Ангионевротический отёк", "Двусторонний стеноз почечных артерий"],
    sideEffects: ["Сухой кашель", "Гиперкалиемия", "Гипотензия", "Сыпь"],
    pregnancyCat: "D",
    defaultDosing: { adult: "По 25 мг 2–3 раза в день за 1 час до еды; для купирования криза 25 мг под язык" },
  },
  atorvastatin: {
    atcCode: "C10AA05",
    indications: ["E78", "I20", "I25", "I63"],
    contraindications: [
      "Активные заболевания печени",
      "Беременность, лактация",
      "Гиперчувствительность",
      "Тяжёлая миопатия в анамнезе на статинах",
    ],
    sideEffects: ["Миалгия, миопатия", "Повышение АЛТ/АСТ", "Диспепсия", "Головная боль"],
    pregnancyCat: "X",
    defaultDosing: { adult: "Старт 10–20 мг 1 раз в день вечером, поддерживающая до 80 мг" },
  },
  aspirin_cardio: {
    atcCode: "B01AC06",
    indications: ["I20", "I21", "I25", "I63", "I64"],
    contraindications: [
      "Активная язвенная болезнь",
      "Геморрагические диатезы",
      "Тяжёлая печёночная или почечная недостаточность",
      "Возраст до 18 лет (риск синдрома Рея)",
    ],
    sideEffects: ["Гастропатия", "Кровотечения", "Бронхоспазм у чувствительных"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: { adult: "По 75–100 мг 1 раз в день после ужина, постоянно" },
  },
  clopidogrel: {
    atcCode: "B01AC04",
    indications: ["I20", "I21", "I25", "I63", "I73"],
    contraindications: [
      "Активное кровотечение",
      "Тяжёлая печёночная недостаточность",
      "Беременность, лактация",
    ],
    sideEffects: ["Кровотечения", "Гематомы", "Диспепсия", "Кожные реакции"],
    pregnancyCat: "B",
    defaultDosing: { adult: "75 мг 1 раз в день, обычно с АСК 75–100 мг" },
  },

  // ─── Respiratory ────────────────────────────────────────────
  salbutamol: {
    atcCode: "R03AC02",
    indications: ["J45", "J44"],
    contraindications: ["Тахиаритмии", "Гиперчувствительность"],
    sideEffects: ["Тахикардия", "Тремор", "Головная боль", "Гипокалиемия"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "1–2 ингаляции (100 мкг) при приступе, до 4 раз в день",
      pediatric: "1 ингаляция при приступе",
    },
  },
  berodual: {
    atcCode: "R03AL01",
    indications: ["J45", "J44", "J42"],
    contraindications: [
      "Тахиаритмия",
      "Гипертрофическая обструктивная кардиомиопатия",
      "Закрытоугольная глаукома",
    ],
    sideEffects: ["Тахикардия", "Тремор", "Сухость во рту"],
    pregnancyCat: "B",
    defaultDosing: {
      adult: "1–2 ингаляции 3 раза в день или 20–40 капель через небулайзер с физраствором",
      pediatric: "6–12 лет: 10–20 капель 3 раза в день через небулайзер",
    },
  },
  acetylcysteine: {
    atcCode: "R05CB01",
    indications: ["J20", "J42", "J44", "J47"],
    contraindications: ["Язвенная болезнь в обострении", "Лёгочное кровотечение"],
    sideEffects: ["Изжога", "Тошнота", "Бронхоспазм (редко)"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "По 200 мг 3 раза в день или 600 мг 1 раз в день, 5–7 дней",
      pediatric: "От 2 лет: 100–200 мг 2–3 раза в день",
    },
  },
  ambroxol: {
    atcCode: "R05CB06",
    indications: ["J20", "J42", "J44", "J18"],
    contraindications: ["Гиперчувствительность", "Язвенная болезнь в обострении"],
    sideEffects: ["Диспепсия", "Сыпь (редко)"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "По 30 мг 3 раза в день первые 2–3 дня, затем 2 раза в день",
      pediatric: "До 2 лет: 7,5 мг 2 раза в день; 2–5 лет: 7,5 мг 3 раза в день; 6–12 лет: 15 мг 3 раза в день",
    },
  },
  bromhexine: {
    atcCode: "R05CB02",
    indications: ["J20", "J42", "J44"],
    contraindications: ["Гиперчувствительность", "1 триместр беременности"],
    sideEffects: ["Диспепсия", "Сыпь"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "По 8 мг 3–4 раза в день",
      pediatric: "До 6 лет: 4 мг 3 раза в день; 6–10 лет: 6–8 мг 3 раза в день",
    },
  },

  // ─── Antispasmodic ──────────────────────────────────────────
  drotaverine: {
    atcCode: "A03AD02",
    indications: ["K58", "N20", "K80", "N94", "G43"],
    contraindications: [
      "Тяжёлая сердечная, печёночная или почечная недостаточность",
      "Возраст до 1 года",
      "AV-блокада 2–3 степени",
    ],
    sideEffects: ["Гипотензия", "Тахикардия", "Головокружение", "Тошнота"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: {
      adult: "По 40–80 мг 2–3 раза в день",
      pediatric: "1–6 лет: 10–20 мг 1–2 раза в день",
    },
  },
  buscopan: {
    atcCode: "A03BB01",
    indications: ["K58", "N20", "K80", "N94"],
    contraindications: ["Закрытоугольная глаукома", "Аденома простаты с задержкой мочи", "Миастения"],
    sideEffects: ["Сухость во рту", "Тахикардия", "Запор", "Задержка мочи"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: { adult: "По 10 мг 3–5 раз в день" },
  },

  // ─── Endocrine ──────────────────────────────────────────────
  metformin: {
    atcCode: "A10BA02",
    indications: ["E11", "E66", "E28"],
    contraindications: [
      "Острые состояния с риском лактоацидоза",
      "Тяжёлая почечная недостаточность (СКФ <30)",
      "Тяжёлая печёночная недостаточность",
      "Кетоацидоз, кома",
    ],
    sideEffects: ["Диарея, тошнота (начало приёма)", "Металлический привкус", "Дефицит B12 (длительно)", "Лактоацидоз (редко)"],
    pregnancyCat: "B",
    defaultDosing: {
      adult: "Старт 500 мг 1 раз в день вечером с едой, титрация до 2000–2550 мг в 2–3 приёма",
    },
  },
  lthyroxine: {
    atcCode: "H03AA01",
    indications: ["E03", "E89", "C73"],
    contraindications: [
      "Тиреотоксикоз",
      "Острый инфаркт миокарда",
      "Нелеченая надпочечниковая недостаточность",
    ],
    sideEffects: ["При передозировке — тахикардия, тремор, потеря веса, бессонница", "Аритмии у пожилых"],
    pregnancyCat: "A",
    defaultDosing: {
      adult: "1,6 мкг/кг 1 раз в день утром натощак за 30–60 мин до еды",
      elderly: "Старт 25–50 мкг, медленная титрация",
    },
  },

  // ─── Diuretics ──────────────────────────────────────────────
  furosemide: {
    atcCode: "C03CA01",
    indications: ["I50", "R60", "N04", "I10"],
    contraindications: [
      "Анурия",
      "Тяжёлые электролитные нарушения",
      "Гиповолемия",
      "Печёночная кома",
    ],
    sideEffects: ["Гипокалиемия", "Гипонатриемия", "Гипотензия", "Ототоксичность (в/в быстро)", "Гипергликемия"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "По 20–40 мг 1 раз в день утром, при необходимости в/в 20–40 мг",
    },
  },
  indapamide: {
    atcCode: "C03BA11",
    indications: ["I10"],
    contraindications: [
      "Тяжёлая почечная недостаточность",
      "Тяжёлая печёночная недостаточность",
      "Гипокалиемия",
      "Беременность, лактация",
    ],
    sideEffects: ["Гипокалиемия", "Гиперурикемия", "Гипергликемия", "Головокружение"],
    pregnancyCat: "B",
    defaultDosing: { adult: "1,5 мг 1 раз в день утром" },
  },

  // ─── Steroids ───────────────────────────────────────────────
  prednisolone: {
    atcCode: "H02AB06",
    indications: ["L50", "J45", "M05", "M06", "T78.2"],
    contraindications: [
      "Системные грибковые инфекции",
      "Гиперчувствительность",
      "Активная инфекция без сопутствующей терапии",
    ],
    sideEffects: ["Гипергликемия", "Артериальная гипертензия", "Остеопороз (длительно)", "Иммуносупрессия", "Кушингоид"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "5–60 мг/сут per os или 30–60 мг в/в, по показаниям",
      pediatric: "1–2 мг/кг/сут",
    },
  },
  dexamethasone: {
    atcCode: "H02AB02",
    indications: ["T78.2", "G93.6", "C00-C99 (как противорвотное)", "J45"],
    contraindications: [
      "Системные грибковые инфекции",
      "Гиперчувствительность",
    ],
    sideEffects: ["Гипергликемия", "Гипертензия", "Иммуносупрессия", "Психические нарушения"],
    pregnancyCat: "C",
    defaultDosing: {
      adult: "0,5–9 мг/сут per os или 4–8 мг в/в/в/м",
    },
  },

  // ─── Vitamins ───────────────────────────────────────────────
  vitamin_d3: {
    atcCode: "A11CC05",
    indications: ["E55", "M83", "E83.3"],
    contraindications: [
      "Гипервитаминоз D",
      "Гиперкальциемия",
      "Активный туберкулёз",
      "Нефролитиаз с оксалатными камнями",
    ],
    sideEffects: ["При передозировке — гиперкальциемия, тошнота, полиурия"],
    pregnancyCat: "A",
    rxOnly: false,
    defaultDosing: {
      adult: "1000–2000 МЕ/сут профилактически, 4000–10000 МЕ/сут при дефиците (контроль 25(OH)D)",
      pediatric: "Грудной возраст: 400–500 МЕ/сут; 1–18 лет: 600–1000 МЕ/сут",
    },
  },
  magnesium_b6: {
    atcCode: "A12CC30",
    indications: ["E61.2", "G43", "G47.0", "F41"],
    contraindications: ["Тяжёлая почечная недостаточность", "Фенилкетонурия"],
    sideEffects: ["Диарея", "Диспепсия"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "По 2 таб 3 раза в день, 4–6 недель",
      pediatric: "От 6 лет: 4–6 таб/сут",
    },
  },
  iron_sorbifer: {
    atcCode: "B03AE10",
    indications: ["D50", "D62", "O99.0"],
    contraindications: [
      "Гемосидероз, гемохроматоз",
      "Стеноз пищевода",
      "Возраст до 12 лет (таблетки)",
    ],
    sideEffects: ["Запор", "Тошнота", "Окрашивание стула в чёрный цвет", "Эпигастральная боль"],
    pregnancyCat: "A",
    rxOnly: false,
    defaultDosing: { adult: "По 1 таб 1–2 раза в день между приёмами пищи" },
  },
  folic_acid: {
    atcCode: "B03BB01",
    indications: ["D52", "O99.0", "Q-codes (профилактика NTD)"],
    contraindications: ["Гиперчувствительность", "Дефицит B12 без коррекции"],
    sideEffects: ["Аллергические реакции (редко)"],
    pregnancyCat: "A",
    rxOnly: false,
    defaultDosing: {
      adult: "1–5 мг/сут при дефиците; 400 мкг/сут планирующим беременность",
    },
  },

  // ─── Sedatives ──────────────────────────────────────────────
  glycine: {
    indications: ["F43", "F45", "G47.0"],
    contraindications: ["Гиперчувствительность"],
    sideEffects: ["Аллергические реакции (редко)"],
    pregnancyCat: "UNKNOWN",
    rxOnly: false,
    defaultDosing: { adult: "По 100 мг (1 таб) под язык 2–3 раза в день, курс 14–30 дней" },
  },
  melatonin: {
    atcCode: "N05CH01",
    indications: ["G47.0", "F51"],
    contraindications: [
      "Аутоиммунные заболевания",
      "Тяжёлая почечная недостаточность",
      "Беременность, лактация",
    ],
    sideEffects: ["Утренняя сонливость", "Головная боль", "Яркие сны"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: { adult: "3 мг за 30–60 мин до сна, курс не более 2 месяцев" },
  },

  // ─── Topical ────────────────────────────────────────────────
  levomekol: {
    atcCode: "D06C",
    indications: ["L02", "L03", "T81.4"],
    contraindications: ["Гиперчувствительность"],
    sideEffects: ["Аллергический контактный дерматит (редко)"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: { adult: "На рану ежедневно 1–2 раза, под повязку, до очищения" },
  },
  bepanten: {
    atcCode: "D03AX03",
    indications: ["L20", "L22", "L98", "N64.0"],
    contraindications: ["Гиперчувствительность"],
    sideEffects: ["Аллергический контактный дерматит (редко)"],
    pregnancyCat: "A",
    rxOnly: false,
    defaultDosing: { adult: "Наносить 1–3 раза в день на поражённые участки" },
  },
  acyclovir: {
    atcCode: "J05AB01",
    indications: ["B00", "B02"],
    contraindications: ["Гиперчувствительность к ацикловиру/валацикловиру"],
    sideEffects: ["При системном приёме — нефротоксичность (редко)", "Тошнота", "Головная боль"],
    pregnancyCat: "B",
    defaultDosing: {
      adult: "Внутрь по 200 мг 5 раз в день 5 дней при простом герпесе; крем — 5 раз в день 5 дней",
    },
  },

  // ─── Eye / Ear ──────────────────────────────────────────────
  tobrex: {
    atcCode: "S01AA12",
    indications: ["H10", "H16", "H66"],
    contraindications: ["Гиперчувствительность к аминогликозидам"],
    sideEffects: ["Жжение", "Покраснение конъюнктивы", "Аллергические реакции"],
    pregnancyCat: "C",
    defaultDosing: { adult: "По 1–2 капли в поражённый глаз каждые 4 часа, 7 дней" },
  },
  sulfacyl: {
    atcCode: "S01AB04",
    indications: ["H10", "H16"],
    contraindications: ["Гиперчувствительность к сульфаниламидам"],
    sideEffects: ["Жжение", "Слезотечение", "Аллергические реакции"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: { adult: "По 1–2 капли 4–6 раз в день, до 7 дней" },
  },
  otipax: {
    atcCode: "S02DA30",
    indications: ["H66", "H92"],
    contraindications: [
      "Перфорация барабанной перепонки",
      "Гиперчувствительность к местным анестетикам",
    ],
    sideEffects: ["Аллергические реакции", "Раздражение кожи слухового прохода"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: { adult: "По 4 капли 2–3 раза в день в поражённое ухо, не более 10 дней" },
  },
};
