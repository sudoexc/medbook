/**
 * Clinical enrichment for the static drug catalog in `_drug-catalog.ts`.
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

  // ═══════════════════════════════════════════════════════════
  //  Расширенный каталог (v2) — клиническое обогащение
  // ═══════════════════════════════════════════════════════════

  // ─── Противоэпилептические ────────────────────────────────
  carbamazepine: {
    atcCode: "N03AF01",
    indications: ["G40", "G50", "G51", "F31", "G35"],
    contraindications: [
      "AV-блокада",
      "Угнетение костномозгового кроветворения, порфирия",
      "Одновременный приём ингибиторов МАО",
      "Гиперчувствительность к трициклическим соединениям",
    ],
    sideEffects: ["Сонливость", "Головокружение, атаксия", "Гипонатриемия", "Лейкопения", "Кожные реакции (вплоть до СДЖ/ТЭН)"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 100–200 мг 1–2 раза в день, титровать до 400–1200 мг/сут",
      pediatric: "10–20 мг/кг/сут в 2–3 приёма",
      elderly: "Снижать стартовую дозу, медленная титрация",
    },
  },
  valproate: {
    atcCode: "N03AG01",
    indications: ["G40", "G41", "F31", "G43"],
    contraindications: [
      "Заболевания печени, печёночная порфирия",
      "Беременность (тератогенность, риск нарушений развития)",
      "Митохондриальные заболевания (POLG)",
      "Панкреатит в анамнезе",
    ],
    sideEffects: ["Тремор", "Увеличение массы тела", "Выпадение волос", "Гепатотоксичность", "Тромбоцитопения", "Гипераммониемия"],
    pregnancyCat: "X",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 10–15 мг/кг/сут, поддержание 1000–2000 мг/сут в 2 приёма",
      pediatric: "15–30 мг/кг/сут в 2 приёма",
    },
  },
  lamotrigine: {
    atcCode: "N03AX09",
    indications: ["G40", "F31"],
    contraindications: ["Гиперчувствительность к ламотриджину"],
    sideEffects: ["Кожная сыпь (риск СДЖ при быстрой титрации)", "Головная боль", "Диплопия", "Головокружение", "Бессонница"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 25 мг/сут, медленная титрация до 100–200 мг/сут (доза зависит от сопутствующей терапии)",
      pediatric: "0,3–0,6 мг/кг/сут с медленным повышением",
    },
  },
  levetiracetam: {
    atcCode: "N03AX14",
    indications: ["G40", "G41"],
    contraindications: ["Гиперчувствительность к производным пирролидона"],
    sideEffects: ["Сонливость", "Астения", "Раздражительность, поведенческие изменения", "Головокружение"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 250–500 мг 2 раза в день, до 1500 мг 2 раза в день",
      pediatric: "10 мг/кг 2 раза в день, до 30 мг/кг 2 раза в день",
      renal: "Снижать дозу по клиренсу креатинина",
    },
  },
  topiramate: {
    atcCode: "N03AX11",
    indications: ["G40", "G43"],
    contraindications: ["Гиперчувствительность", "Осторожно при нефролитиазе и закрытоугольной глаукоме"],
    sideEffects: ["Парестезии", "Снижение массы тела", "Когнитивные нарушения, замедление речи", "Нефролитиаз", "Метаболический ацидоз"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "Эпилепсия: 200–400 мг/сут; профилактика мигрени: 50–100 мг/сут, титровать с 25 мг",
      pediatric: "5–9 мг/кг/сут в 2 приёма",
    },
  },
  gabapentin: {
    atcCode: "N03AX12",
    indications: ["G62", "G63", "G50", "M79", "G40", "B02"],
    contraindications: ["Гиперчувствительность", "Острый панкреатит"],
    sideEffects: ["Сонливость", "Головокружение", "Периферические отёки", "Атаксия", "Увеличение массы тела"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 300 мг на ночь, титровать до 900–3600 мг/сут в 3 приёма",
      renal: "Снижать дозу по клиренсу креатинина",
    },
  },
  pregabalin: {
    atcCode: "N03AX16",
    indications: ["G62", "G63", "G50", "M79", "F41", "G40"],
    contraindications: ["Гиперчувствительность", "Редкие наследственные нарушения толерантности к галактозе"],
    sideEffects: ["Головокружение", "Сонливость", "Периферические отёки", "Увеличение массы тела", "Эйфория (потенциал злоупотребления)"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 75 мг 2 раза в день, до 150–300 мг 2 раза в день",
      renal: "Снижать дозу по клиренсу креатинина",
    },
  },
  phenobarbital: {
    atcCode: "N03AA02",
    indications: ["G40", "G41"],
    contraindications: ["Тяжёлая дыхательная недостаточность", "Печёночная/почечная недостаточность", "Порфирия", "Зависимость в анамнезе"],
    sideEffects: ["Седация", "Когнитивные и поведенческие нарушения", "Зависимость", "Остеомаляция при длительном приёме"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "60–180 мг/сут на ночь",
      pediatric: "3–5 мг/кг/сут",
    },
  },

  // ─── Мигрень и миорелаксанты ──────────────────────────────
  sumatriptan: {
    atcCode: "N02CC01",
    indications: ["G43"],
    contraindications: [
      "ИБС, инфаркт миокарда в анамнезе",
      "Неконтролируемая артериальная гипертензия",
      "Цереброваскулярные нарушения (инсульт/ТИА)",
      "Гемиплегическая и базилярная мигрень",
      "Приём эрготамина или иМАО",
    ],
    sideEffects: ["Чувство покалывания и тепла", "Сдавление в груди и горле", "Головокружение", "Сонливость", "Транзиторное повышение АД"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "50–100 мг внутрь при приступе, повтор не ранее чем через 2 ч; макс. 300 мг/сут",
    },
  },
  tolperisone: {
    atcCode: "M03BX04",
    indications: ["M54", "M53", "G54", "G80", "I69"],
    contraindications: ["Миастения", "Гиперчувствительность к толперизону или лидокаину (для инъекций)"],
    sideEffects: ["Мышечная слабость", "Головная боль", "Артериальная гипотензия", "Тошнота", "Аллергические реакции"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "150 мг 2–3 раза в день; в/м 100 мг 2 раза в день",
    },
  },
  tizanidine: {
    atcCode: "M03BX02",
    indications: ["M54", "G35", "G80", "I69", "G95"],
    contraindications: ["Тяжёлая печёночная недостаточность", "Совместный приём с флувоксамином или ципрофлоксацином"],
    sideEffects: ["Сонливость", "Сухость во рту", "Артериальная гипотензия", "Головокружение", "Повышение трансаминаз"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 2 мг 2–3 раза в день, до 12–24 мг/сут",
    },
  },
  baclofen: {
    atcCode: "M03BX01",
    indications: ["G35", "G80", "G82", "G95", "I69"],
    contraindications: ["Эпилепсия (осторожно)", "Язвенная болезнь в обострении", "Гиперчувствительность"],
    sideEffects: ["Сонливость", "Мышечная слабость", "Тошнота", "Головокружение", "Синдром отмены при резкой отмене"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 5 мг 3 раза в день, титровать до 30–75 мг/сут",
    },
  },

  // ─── Сосудистые, ноотропы, вестибулотропики ───────────────
  piracetam: {
    atcCode: "N06BX03",
    indications: ["I67", "I69", "G93", "F06", "F03"],
    contraindications: ["Тяжёлая почечная недостаточность", "Геморрагический инсульт", "Хорея Гентингтона"],
    sideEffects: ["Возбуждение, раздражительность", "Бессонница", "Головокружение", "Диспепсия"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "1200–4800 мг/сут в 2–3 приёма; в/в при острых состояниях",
      renal: "Снижать дозу по клиренсу креатинина",
    },
  },
  citicoline: {
    atcCode: "N06BX06",
    indications: ["I63", "I69", "G93", "S06", "F03"],
    contraindications: ["Выраженная ваготония", "Гиперчувствительность"],
    sideEffects: ["Тошнота", "Головная боль", "Транзиторное изменение АД", "Бессонница"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Острый период: 1000 мг/сут в/в; поддержание: 500–1000 мг/сут внутрь",
    },
  },
  vinpocetine: {
    atcCode: "N06BX18",
    indications: ["I67", "I69", "H93", "H81"],
    contraindications: ["Острая фаза геморрагического инсульта", "Тяжёлая ИБС, аритмии", "Беременность, лактация"],
    sideEffects: ["Снижение АД", "Тахикардия", "Головная боль", "Сухость во рту"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "5–10 мг 3 раза в день; в/в капельно при острых состояниях",
    },
  },
  cinnarizine: {
    atcCode: "N07CA02",
    indications: ["H81", "H82", "I67", "R42"],
    contraindications: ["Болезнь Паркинсона (осторожно)", "Гиперчувствительность"],
    sideEffects: ["Сонливость", "Диспепсия", "Сухость во рту", "Экстрапирамидные нарушения при длительном приёме"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: {
      adult: "25 мг 3 раза в день; при вестибулярных нарушениях до 75 мг/сут",
    },
  },
  betahistine: {
    atcCode: "N07CA01",
    indications: ["H81", "H82", "H83", "R42"],
    contraindications: ["Феохромоцитома", "Язвенная болезнь в обострении", "Бронхиальная астма (осторожно)"],
    sideEffects: ["Диспепсия", "Головная боль", "Кожная сыпь", "Тошнота"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "24 мг 2 раза в день или 16 мг 3 раза в день",
    },
  },
  mexidol: {
    atcCode: "N07XX",
    indications: ["I63", "I67", "I69", "F48", "G93"],
    contraindications: ["Острая печёночная/почечная недостаточность", "Гиперчувствительность", "Беременность, лактация"],
    sideEffects: ["Тошнота", "Сухость во рту", "Сонливость", "Аллергические реакции"],
    pregnancyCat: "UNKNOWN",
    rxOnly: true,
    defaultDosing: {
      adult: "Внутрь 125–250 мг 3 раза в день; в/в 250–500 мг/сут в остром периоде",
    },
  },
  nicergoline: {
    atcCode: "C04AE02",
    indications: ["I67", "I69", "F03", "H34", "I73"],
    contraindications: ["Острое кровотечение", "Инфаркт миокарда", "Выраженная брадикардия", "Ортостатическая гипотензия"],
    sideEffects: ["Снижение АД", "Приливы", "Головокружение", "Диспепсия", "Сонливость"],
    pregnancyCat: "UNKNOWN",
    rxOnly: true,
    defaultDosing: {
      adult: "10 мг 3 раза в день или 30 мг 1–2 раза в день",
    },
  },
  pentoxifylline: {
    atcCode: "C04AD03",
    indications: ["I73", "I67", "I69", "H34", "E11"],
    contraindications: ["Массивное кровотечение", "Кровоизлияние в сетчатку", "Геморрагический инсульт", "Острый инфаркт миокарда"],
    sideEffects: ["Покраснение лица", "Снижение АД", "Тошнота", "Головокружение", "Тахикардия"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "100–400 мг 2–3 раза в день; в/в капельно 100–300 мг",
    },
  },
  phenibut: {
    atcCode: "N06BX22",
    indications: ["F41", "F48", "F90", "G47", "H81"],
    contraindications: ["Печёночная недостаточность", "Язвенная болезнь в обострении", "Гиперчувствительность"],
    sideEffects: ["Сонливость", "Тошнота", "Головная боль", "Раздражительность в начале приёма"],
    pregnancyCat: "UNKNOWN",
    rxOnly: true,
    defaultDosing: {
      adult: "250–500 мг 3 раза в день, курс 2–3 недели",
      pediatric: "Детям старше 8 лет 250 мг 3 раза в день",
    },
  },

  // ─── Паркинсонизм и деменция ──────────────────────────────
  levodopa_carbidopa: {
    atcCode: "N04BA02",
    indications: ["G20", "G21"],
    contraindications: ["Закрытоугольная глаукома", "Меланома в анамнезе", "Приём неселективных иМАО", "Тяжёлые психозы"],
    sideEffects: ["Дискинезии", "Тошнота", "Ортостатическая гипотензия", "Феномен «включения-выключения»", "Зрительные галлюцинации"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 1/2 таб. 100/25 мг 3 раза в день, титровать по эффекту",
    },
  },
  pramipexole: {
    atcCode: "N04BC05",
    indications: ["G20", "G25"],
    contraindications: ["Гиперчувствительность", "Осторожно при психозах и нарушении контроля импульсов"],
    sideEffects: ["Сонливость, внезапные засыпания", "Тошнота", "Ортостатическая гипотензия", "Галлюцинации", "Импульсивное поведение"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Болезнь Паркинсона: титровать до 1,5–4,5 мг/сут; СБН: 0,125–0,75 мг на ночь",
      renal: "Снижать дозу по клиренсу креатинина",
    },
  },
  memantine: {
    atcCode: "N06DX01",
    indications: ["G30", "F00", "F03"],
    contraindications: ["Тяжёлая почечная недостаточность", "Гиперчувствительность"],
    sideEffects: ["Головокружение", "Головная боль", "Запор", "Сонливость", "Артериальная гипертензия"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 5 мг/сут, +5 мг в неделю до 20 мг/сут",
      renal: "Снижать дозу по клиренсу креатинина",
    },
  },
  donepezil: {
    atcCode: "N06DA02",
    indications: ["G30", "F00"],
    contraindications: ["Гиперчувствительность к производным пиперидина", "Осторожно при брадикардии и язвенной болезни"],
    sideEffects: ["Тошнота, диарея", "Брадикардия", "Бессонница, яркие сны", "Мышечные судороги", "Снижение аппетита"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 5 мг на ночь, через 4–6 недель до 10 мг/сут",
    },
  },

  // ─── Невропатия и витамины группы B ───────────────────────
  milgamma: {
    atcCode: "A11DBN",
    indications: ["G62", "G63", "G50", "G54", "M54", "E11"],
    contraindications: ["Декомпенсированная сердечная недостаточность", "Гиперчувствительность к витаминам группы B"],
    sideEffects: ["Аллергические реакции", "Потливость", "Тахикардия", "Раздражение в месте инъекции"],
    pregnancyCat: "UNKNOWN",
    rxOnly: true,
    defaultDosing: {
      adult: "В/м 2 мл/сут 5–10 дней, затем переход на таблетки 1–3 раза в день",
    },
  },
  thioctic_acid: {
    atcCode: "A16AX01",
    indications: ["G63", "G62", "E11", "E10", "K76"],
    contraindications: ["Гиперчувствительность", "Беременность, лактация", "Детский возраст"],
    sideEffects: ["Гипогликемия", "Тошнота", "Аллергические реакции", "Изменение вкуса"],
    pregnancyCat: "UNKNOWN",
    rxOnly: true,
    defaultDosing: {
      adult: "В/в 600 мг/сут 2–4 недели, затем внутрь 600 мг/сут натощак",
    },
  },

  // ─── Антидепрессанты ──────────────────────────────────────
  amitriptyline: {
    atcCode: "N06AA09",
    indications: ["F32", "F33", "F41", "G43", "G50", "G62", "M79", "G47"],
    contraindications: [
      "Острый период инфаркта миокарда",
      "Закрытоугольная глаукома",
      "Аденома простаты с задержкой мочи",
      "Приём иМАО",
      "Выраженные нарушения проводимости сердца",
    ],
    sideEffects: ["Сухость во рту", "Запор", "Сонливость", "Ортостатическая гипотензия", "Увеличение массы тела", "Задержка мочи"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Депрессия: 25–75 мг/сут с повышением; нейропатическая боль: 10–25 мг на ночь",
      elderly: "Стартовать с 10 мг на ночь",
    },
  },
  sertraline: {
    atcCode: "N06AB06",
    indications: ["F32", "F33", "F41", "F42", "F43"],
    contraindications: ["Приём иМАО", "Совместный приём с пимозидом", "Гиперчувствительность"],
    sideEffects: ["Тошнота", "Диарея", "Бессонница", "Снижение либидо", "Тремор", "Потливость"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 50 мг/сут, до 100–200 мг/сут",
    },
  },
  escitalopram: {
    atcCode: "N06AB10",
    indications: ["F32", "F33", "F41", "F42"],
    contraindications: ["Приём иМАО", "Удлинение интервала QT", "Гиперчувствительность"],
    sideEffects: ["Тошнота", "Бессонница или сонливость", "Снижение либидо", "Потливость", "Удлинение QT"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 10 мг/сут, при необходимости до 20 мг/сут",
      elderly: "Максимум 10 мг/сут",
    },
  },
  venlafaxine: {
    atcCode: "N06AX16",
    indications: ["F32", "F33", "F41", "G43"],
    contraindications: ["Приём иМАО", "Неконтролируемая артериальная гипертензия", "Гиперчувствительность"],
    sideEffects: ["Тошнота", "Повышение АД (дозозависимо)", "Потливость", "Бессонница", "Синдром отмены"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 75 мг/сут, до 150–225 мг/сут (форма пролонг — 1 раз в день)",
    },
  },
  duloxetine: {
    atcCode: "N06AX21",
    indications: ["F32", "F41", "G62", "G63", "M54", "M79"],
    contraindications: ["Приём иМАО", "Тяжёлая печёночная недостаточность", "Неконтролируемая глаукома"],
    sideEffects: ["Тошнота", "Сухость во рту", "Запор", "Сонливость", "Снижение аппетита"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "60 мг/сут однократно (старт 30 мг при чувствительности)",
    },
  },

  // ─── Анксиолитики и седативные ────────────────────────────
  tofisopam: {
    atcCode: "N05BA23",
    indications: ["F41", "F45", "F48", "G90"],
    contraindications: ["Тяжёлая дыхательная недостаточность", "I триместр беременности", "Состояния с психомоторным возбуждением"],
    sideEffects: ["Головная боль", "Возбуждение", "Тошнота", "Сухость во рту"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "50–100 мг 1–3 раза в день",
    },
  },
  hydroxyzine: {
    atcCode: "N05BB01",
    indications: ["F41", "F45", "L20", "L29", "L50"],
    contraindications: ["Удлинение интервала QT", "Закрытоугольная глаукома", "Порфирия", "Ранние сроки беременности"],
    sideEffects: ["Сонливость", "Сухость во рту", "Головная боль", "Удлинение QT"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Тревога: 25–100 мг/сут в несколько приёмов; зуд: 25 мг 3–4 раза в день",
      pediatric: "1–2 мг/кг/сут в несколько приёмов",
    },
  },
  afobazole: {
    atcCode: "N05BX04",
    indications: ["F41", "F48", "F45"],
    contraindications: ["Гиперчувствительность", "Беременность, лактация", "Непереносимость лактозы"],
    sideEffects: ["Головная боль", "Аллергические реакции (редко)"],
    pregnancyCat: "UNKNOWN",
    rxOnly: false,
    defaultDosing: {
      adult: "10 мг 3 раза в день, курс 2–4 недели",
    },
  },
  diazepam: {
    atcCode: "N05BA01",
    indications: ["F41", "G40", "G41", "M62", "F10", "R56"],
    contraindications: ["Миастения", "Тяжёлая дыхательная недостаточность", "Синдром апноэ во сне", "Закрытоугольная глаукома"],
    sideEffects: ["Сонливость", "Мышечная слабость", "Атаксия", "Зависимость", "Парадоксальное возбуждение"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "Внутрь 2–10 мг 2–4 раза в день; в/в при судорогах 5–10 мг",
    },
  },
  phenazepam: {
    atcCode: "N05BX",
    indications: ["F41", "F40", "G47", "F10"],
    contraindications: ["Миастения", "Тяжёлая дыхательная недостаточность", "Закрытоугольная глаукома", "Беременность"],
    sideEffects: ["Седация", "Атаксия", "Зависимость", "Снижение концентрации внимания"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "0,5–1 мг 2–3 раза в день, коротким курсом",
    },
  },

  // ─── Антибиотики (дополнительно) ──────────────────────────
  cefuroxime: {
    atcCode: "J01DC02",
    indications: ["J01", "J02", "J03", "J18", "J20", "L03", "N30"],
    contraindications: ["Гиперчувствительность к цефалоспоринам", "Тяжёлая аллергия на пенициллины"],
    sideEffects: ["Диарея", "Тошнота", "Кожная сыпь", "Кандидоз", "Эозинофилия"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "250–500 мг 2 раза в день; в/м 750 мг–1,5 г каждые 8 ч",
      pediatric: "10–15 мг/кг 2 раза в день",
    },
  },
  nitrofurantoin: {
    atcCode: "J01XE01",
    indications: ["N30", "N39"],
    contraindications: ["Тяжёлая почечная недостаточность (КК <45)", "Беременность в срок ≥38 недель", "Дефицит Г6ФД", "Полинейропатия"],
    sideEffects: ["Тошнота", "Диспепсия", "Лёгочные реакции при длительном приёме", "Периферическая нейропатия", "Окрашивание мочи"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "100 мг 3–4 раза в день 5–7 дней",
    },
  },
  fosfomycin: {
    atcCode: "J01XX01",
    indications: ["N30", "N39"],
    contraindications: ["Тяжёлая почечная недостаточность", "Гиперчувствительность"],
    sideEffects: ["Диарея", "Тошнота", "Головная боль", "Вульвовагинит"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "3 г однократно натощак, растворив в воде (на ночь после опорожнения пузыря)",
    },
  },
  co_trimoxazole: {
    atcCode: "J01EE01",
    indications: ["J18", "N30", "N39", "A09", "B59"],
    contraindications: ["Тяжёлая печёночная/почечная недостаточность", "Дефицит Г6ФД", "Беременность, лактация", "Мегалобластная анемия (дефицит фолатов)"],
    sideEffects: ["Кожная сыпь (риск СДЖ)", "Тошнота", "Гиперкалиемия", "Угнетение кроветворения", "Фотосенсибилизация"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "960 мг 2 раза в день",
      pediatric: "По триметоприму 4–6 мг/кг 2 раза в день",
    },
  },
  moxifloxacin: {
    atcCode: "J01MA14",
    indications: ["J01", "J18", "J20", "J44"],
    contraindications: ["Возраст до 18 лет", "Удлинение QT", "Беременность, лактация", "Эпилепсия", "Заболевания сухожилий на фоне фторхинолонов"],
    sideEffects: ["Удлинение QT", "Тошнота", "Тендинит, разрыв сухожилий", "Гепатотоксичность", "Дисгликемия"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "400 мг 1 раз в день 5–10 дней",
    },
  },
  gentamicin: {
    atcCode: "J01GB03",
    indications: ["A41", "N10", "N30", "L03", "H10", "H16"],
    contraindications: ["Миастения", "Тяжёлая почечная недостаточность", "Неврит слухового нерва", "Беременность"],
    sideEffects: ["Нефротоксичность", "Ототоксичность", "Нейромышечная блокада", "Аллергические реакции"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "3–5 мг/кг/сут в/м или в/в в 1–3 введения под контролем функции почек",
    },
  },

  // ─── Противогрибковые ─────────────────────────────────────
  fluconazole: {
    atcCode: "J02AC01",
    indications: ["B37", "N77", "B35"],
    contraindications: ["Совместный приём с терфенадином/цизапридом", "Удлинение QT", "Гиперчувствительность к азолам"],
    sideEffects: ["Тошнота", "Головная боль", "Боль в животе", "Повышение трансаминаз", "Удлинение QT"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "Вагинальный кандидоз: 150 мг однократно; системный: 50–400 мг/сут",
    },
  },
  terbinafine: {
    atcCode: "D01BA02",
    indications: ["B35"],
    contraindications: ["Тяжёлая печёночная/почечная недостаточность", "Гиперчувствительность"],
    sideEffects: ["Диспепсия", "Изменение/потеря вкуса", "Кожная сыпь", "Повышение трансаминаз"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "Внутрь 250 мг/сут 2–6 недель (онихомикоз 6–12 недель); крем 1–2 раза в день",
    },
  },
  clotrimazole: {
    atcCode: "G01AF02",
    indications: ["B35", "B37", "N77"],
    contraindications: ["I триместр беременности (для вагинальных форм)", "Гиперчувствительность"],
    sideEffects: ["Местное жжение и зуд", "Эритема", "Раздражение"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "Крем 1% 2–3 раза в день; вагинальные таблетки 100 мг на ночь 6 дней или 500 мг однократно",
    },
  },
  itraconazole: {
    atcCode: "J02AC02",
    indications: ["B35", "B37", "B44"],
    contraindications: ["Хроническая сердечная недостаточность", "Совместный приём с рядом препаратов (CYP3A4)", "Беременность"],
    sideEffects: ["Тошнота", "Боль в животе", "Гепатотоксичность", "Отёки", "Сердечная недостаточность"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "100–200 мг 1–2 раза в день с едой; пульс-терапия при онихомикозе",
    },
  },

  // ─── Противовирусные ──────────────────────────────────────
  valacyclovir: {
    atcCode: "J05AB11",
    indications: ["B00", "B02", "A60"],
    contraindications: ["Гиперчувствительность к ацикловиру/валацикловиру", "Осторожно при почечной недостаточности"],
    sideEffects: ["Головная боль", "Тошнота", "Боль в животе", "Нефротоксичность при дегидратации"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "Herpes labialis: 2000 мг 2 раза в 1 день; опоясывающий лишай: 1000 мг 3 раза в день 7 дней",
      renal: "Снижать дозу по клиренсу креатинина",
    },
  },
  oseltamivir: {
    atcCode: "J05AH02",
    indications: ["J09", "J10", "J11"],
    contraindications: ["Гиперчувствительность", "Осторожно при тяжёлой почечной недостаточности"],
    sideEffects: ["Тошнота, рвота", "Головная боль", "Бессонница", "Нейропсихиатрические реакции (редко)"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "75 мг 2 раза в день 5 дней (начать в первые 48 ч)",
      pediatric: "По массе тела 30–75 мг 2 раза в день",
    },
  },
  umifenovir: {
    atcCode: "J05AX13",
    indications: ["J06", "J10", "J11", "B34"],
    contraindications: ["Гиперчувствительность", "Детский возраст до 3 лет"],
    sideEffects: ["Аллергические реакции"],
    pregnancyCat: "UNKNOWN",
    rxOnly: false,
    defaultDosing: {
      adult: "200 мг 4 раза в день 5 дней",
      pediatric: "50–100 мг 4 раза в день в зависимости от возраста",
    },
  },

  // ─── НПВС (дополнительно) ──────────────────────────────────
  meloxicam: {
    atcCode: "M01AC06",
    indications: ["M15", "M16", "M17", "M54", "M06", "M45", "M79"],
    contraindications: ["Язвенная болезнь в обострении", "Тяжёлая сердечная/почечная/печёночная недостаточность", "III триместр беременности", "Желудочно-кишечное кровотечение"],
    sideEffects: ["Диспепсия", "Риск ЖКТ-кровотечения", "Повышение АД", "Отёки", "Нефротоксичность"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "7,5–15 мг 1 раз в день; в/м 15 мг/сут коротким курсом",
    },
  },
  naproxen: {
    atcCode: "M01AE02",
    indications: ["M54", "M25", "M79", "N94", "G43", "M10"],
    contraindications: ["Язвенная болезнь в обострении", "Тяжёлая сердечная недостаточность", "III триместр беременности"],
    sideEffects: ["Диспепсия", "Риск ЖКТ-кровотечения", "Головная боль", "Отёки"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: {
      adult: "250–500 мг 2 раза в день",
    },
  },
  ketoprofen: {
    atcCode: "M01AE03",
    indications: ["M54", "M25", "M79", "M16", "M17", "K08"],
    contraindications: ["Язвенная болезнь в обострении", "Тяжёлая почечная/печёночная недостаточность", "III триместр беременности", "«Аспириновая» астма"],
    sideEffects: ["Диспепсия", "Риск ЖКТ-кровотечения", "Головокружение", "Отёки", "Фотосенсибилизация (гель)"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Внутрь 50 мг 3 раза или 150 мг (ретард) 1 раз в день; в/м 100 мг 1–2 раза в день",
    },
  },
  celecoxib: {
    atcCode: "M01AH01",
    indications: ["M15", "M16", "M17", "M45", "M06", "M54"],
    contraindications: ["Аортокоронарное шунтирование (периоперационно)", "Тяжёлая ИБС, ХСН", "Активное ЖКТ-кровотечение", "Аллергия на сульфонамиды"],
    sideEffects: ["Диспепсия", "Повышение АД", "Отёки", "Сердечно-сосудистые тромботические события", "Головная боль"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "100–200 мг 1–2 раза в день",
    },
  },

  // ─── Анальгетики ──────────────────────────────────────────
  metamizole: {
    atcCode: "N02BB02",
    indications: ["R52", "R51", "R50", "K08", "N23"],
    contraindications: ["Угнетение кроветворения (агранулоцитоз)", "Дефицит Г6ФД", "«Аспириновая» астма", "Беременность (I и III триместр)"],
    sideEffects: ["Агранулоцитоз (редко, опасно)", "Снижение АД", "Аллергические реакции", "Окрашивание мочи"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "500 мг 2–3 раза в день; в/м/в/в 1000 мг при выраженной боли",
    },
  },
  tramadol: {
    atcCode: "N02AX02",
    indications: ["R52", "M54", "M79", "C79", "S72"],
    contraindications: ["Острое отравление алкоголем/психотропными", "Приём иМАО", "Неконтролируемая эпилепсия", "Тяжёлая дыхательная недостаточность"],
    sideEffects: ["Тошнота, рвота", "Головокружение", "Сонливость", "Запор", "Риск зависимости и серотонинового синдрома"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "50–100 мг каждые 4–6 ч, макс. 400 мг/сут",
      elderly: "Удлинять интервал, снижать суточную дозу",
    },
  },

  // ─── Антигистаминные (дополнительно) ──────────────────────
  fexofenadine: {
    atcCode: "R06AX26",
    indications: ["J30", "L50", "L20", "L29"],
    contraindications: ["Гиперчувствительность", "Детский возраст (для высоких доз)"],
    sideEffects: ["Головная боль", "Сонливость (редко)", "Тошнота"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: {
      adult: "Ринит: 120 мг 1 раз в день; крапивница: 180 мг 1 раз в день",
    },
  },
  levocetirizine: {
    atcCode: "R06AE09",
    indications: ["J30", "L50", "L20", "L29"],
    contraindications: ["Тяжёлая почечная недостаточность (КК <10)", "Гиперчувствительность"],
    sideEffects: ["Сонливость", "Сухость во рту", "Головная боль", "Утомляемость"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "5 мг 1 раз в день вечером",
      pediatric: "Детям 2–6 лет 1,25 мг 2 раза в день",
      renal: "Снижать дозу по клиренсу креатинина",
    },
  },

  // ─── ЖКТ (дополнительно) ──────────────────────────────────
  rabeprazole: {
    atcCode: "A02BC04",
    indications: ["K21", "K25", "K26", "K27", "K29", "K30"],
    contraindications: ["Гиперчувствительность к производным бензимидазола", "Беременность, лактация"],
    sideEffects: ["Головная боль", "Диарея", "Гипомагниемия при длительном приёме", "Дефицит B12 при длительном приёме"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "10–20 мг 1 раз в день утром; эрадикация H. pylori — в составе схемы",
    },
  },
  pancreatin: {
    atcCode: "A09AA02",
    indications: ["K86", "K90", "K91", "K29", "R14"],
    contraindications: ["Острый панкреатит", "Обострение хронического панкреатита", "Гиперчувствительность к свиному белку"],
    sideEffects: ["Диспепсия", "Запор или диарея", "Перианальное раздражение", "Аллергические реакции"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "10000–25000 ЕД липазы с каждым приёмом пищи",
      pediatric: "Доза по липазе на кг и приём пищи",
    },
  },
  ursodeoxycholic: {
    atcCode: "A05AA02",
    indications: ["K80", "K76", "K83", "K71"],
    contraindications: ["Рентгенопозитивные камни", "Нефункционирующий желчный пузырь", "Острый холецистит/холангит", "Билиарный цирроз в стадии декомпенсации"],
    sideEffects: ["Диарея", "Дискомфорт в животе", "Кальцификация камней (редко)"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "10–15 мг/кг/сут на ночь (при холестазе делить на приёмы)",
    },
  },
  lactulose: {
    atcCode: "A06AD11",
    indications: ["K59", "K72", "K76"],
    contraindications: ["Кишечная непроходимость", "Галактоземия", "Подозрение на острый живот"],
    sideEffects: ["Метеоризм", "Спазмы в животе", "Диарея при передозировке", "Нарушение электролитов"],
    pregnancyCat: "B",
    rxOnly: false,
    defaultDosing: {
      adult: "Запор: 15–45 мл/сут; печёночная энцефалопатия: 30–45 мл 3–4 раза в день",
      pediatric: "По возрасту 5–15 мл/сут",
    },
  },
  bismuth: {
    atcCode: "A02BX05",
    indications: ["K25", "K26", "K29", "K21"],
    contraindications: ["Тяжёлая почечная недостаточность", "Беременность, лактация"],
    sideEffects: ["Тёмное окрашивание стула и языка", "Тошнота", "Запор"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "120 мг 4 раза в день или 240 мг 2 раза в день за 30 мин до еды, курс до 8 недель",
    },
  },

  // ─── Кардиология (дополнительно) ──────────────────────────
  metoprolol: {
    atcCode: "C07AB02",
    indications: ["I10", "I20", "I25", "I47", "I48", "I50", "G43"],
    contraindications: ["AV-блокада II–III степени", "Выраженная брадикардия", "Декомпенсированная ХСН", "Бронхиальная астма (осторожно)"],
    sideEffects: ["Брадикардия", "Артериальная гипотензия", "Утомляемость", "Похолодание конечностей", "Бронхоспазм"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "25–100 мг 2 раза в день (тартрат) или 50–200 мг 1 раз в день (сукцинат)",
    },
  },
  nebivolol: {
    atcCode: "C07AB12",
    indications: ["I10", "I50", "I20"],
    contraindications: ["AV-блокада II–III степени", "Выраженная брадикардия", "Декомпенсированная ХСН", "Тяжёлая печёночная недостаточность"],
    sideEffects: ["Головная боль", "Брадикардия", "Утомляемость", "Головокружение"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "5 мг 1 раз в день; ХСН — титровать с 1,25 мг",
      elderly: "Стартовать с 2,5 мг",
    },
  },
  valsartan: {
    atcCode: "C09CA03",
    indications: ["I10", "I50", "I25"],
    contraindications: ["Беременность", "Двусторонний стеноз почечных артерий", "Тяжёлая печёночная недостаточность", "Совместный приём с алискиреном при диабете"],
    sideEffects: ["Гиперкалиемия", "Головокружение", "Гипотензия", "Нарушение функции почек"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "80–160 мг 1 раз в день, до 320 мг/сут",
    },
  },
  ramipril: {
    atcCode: "C09AA05",
    indications: ["I10", "I50", "I25", "E11"],
    contraindications: ["Беременность", "Ангионевротический отёк в анамнезе", "Двусторонний стеноз почечных артерий", "Гиперкалиемия"],
    sideEffects: ["Сухой кашель", "Гиперкалиемия", "Гипотензия", "Ангионевротический отёк (редко)", "Нарушение функции почек"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 2,5 мг/сут, поддержание 5–10 мг/сут",
    },
  },
  rosuvastatin: {
    atcCode: "C10AA07",
    indications: ["E78", "I25", "I70", "I63"],
    contraindications: ["Активное заболевание печени", "Беременность, лактация", "Миопатия", "Тяжёлая почечная недостаточность (для высоких доз)"],
    sideEffects: ["Миалгии", "Повышение трансаминаз", "Головная боль", "Рабдомиолиз (редко)", "Повышение глюкозы"],
    pregnancyCat: "X",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 5–10 мг 1 раз в день, до 20–40 мг/сут",
    },
  },
  nitroglycerin: {
    atcCode: "C01DA02",
    indications: ["I20", "I21", "I25"],
    contraindications: ["Приём ингибиторов ФДЭ-5 (силденафил и др.)", "Артериальная гипотензия", "Гипертрофическая кардиомиопатия", "Тампонада сердца"],
    sideEffects: ["Головная боль", "Снижение АД", "Тахикардия", "Головокружение", "Толерантность при постоянном приёме"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "0,4–0,5 мг под язык при приступе, повтор каждые 5 мин до 3 раз",
    },
  },
  amiodarone: {
    atcCode: "C01BD01",
    indications: ["I47", "I48", "I49"],
    contraindications: ["Брадикардия, СССУ, AV-блокада без ЭКС", "Заболевания щитовидной железы", "Удлинение QT", "Гиперчувствительность к йоду"],
    sideEffects: ["Дисфункция щитовидной железы", "Лёгочный фиброз", "Отложения в роговице", "Фотосенсибилизация", "Гепатотоксичность", "Брадикардия"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "Насыщение 600–800 мг/сут до 10 г суммарно, поддержание 100–200 мг/сут",
    },
  },
  spironolactone: {
    atcCode: "C03DA01",
    indications: ["I50", "K76", "I10", "E26", "N04"],
    contraindications: ["Гиперкалиемия", "Тяжёлая почечная недостаточность", "Болезнь Аддисона", "Совместный приём калийсберегающих средств"],
    sideEffects: ["Гиперкалиемия", "Гинекомастия", "Нарушение менструального цикла", "Головокружение"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "ХСН: 25 мг/сут; асцит/отёки: 50–100 мг/сут",
    },
  },

  // ─── Дыхательная система (дополнительно) ──────────────────
  montelukast: {
    atcCode: "R03DC03",
    indications: ["J45", "J30", "J44"],
    contraindications: ["Гиперчувствительность", "Осторожно при фенилкетонурии (жевательные формы)"],
    sideEffects: ["Головная боль", "Боль в животе", "Нейропсихиатрические реакции (нарушения сна, настроения)", "Респираторные инфекции"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "10 мг 1 раз в день вечером",
      pediatric: "2–5 лет — 4 мг; 6–14 лет — 5 мг вечером",
    },
  },
  budesonide: {
    atcCode: "R03BA02",
    indications: ["J45", "J44", "J30", "J31"],
    contraindications: ["Гиперчувствительность", "Активный туберкулёз дыхательных путей (осторожно)"],
    sideEffects: ["Кандидоз полости рта", "Дисфония", "Раздражение глотки", "Носовое кровотечение (назальная форма)"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "Ингаляции 0,5–1 мг 2 раза в день через небулайзер; назальный спрей 1–2 дозы в каждый ход",
      pediatric: "0,25–0,5 мг 2 раза в день",
    },
  },
  xylometazoline: {
    atcCode: "R01AA07",
    indications: ["J30", "J31", "J00", "J01", "H65", "H66"],
    contraindications: ["Атрофический ринит", "Закрытоугольная глаукома", "После трансфеноидальной гипофизэктомии", "Гиперчувствительность"],
    sideEffects: ["Жжение в носу", "Сухость слизистой", "Медикаментозный ринит при длительном применении", "Чихание"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: {
      adult: "0,1% по 1 дозе в каждый ход 2–3 раза в день, не более 5–7 дней",
      pediatric: "0,05% для детей с 2 лет",
    },
  },

  // ─── Эндокринология / метаболизм (дополнительно) ──────────
  gliclazide: {
    atcCode: "A10BB09",
    indications: ["E11"],
    contraindications: ["Сахарный диабет 1 типа", "Диабетический кетоацидоз", "Тяжёлая печёночная/почечная недостаточность", "Беременность, лактация"],
    sideEffects: ["Гипогликемия", "Увеличение массы тела", "Диспепсия", "Аллергические реакции"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "30–120 мг (МВ) 1 раз в день во время завтрака",
      elderly: "Стартовать с минимальной дозы",
    },
  },
  sitagliptin: {
    atcCode: "A10BH01",
    indications: ["E11"],
    contraindications: ["Сахарный диабет 1 типа", "Диабетический кетоацидоз", "Гиперчувствительность"],
    sideEffects: ["Назофарингит", "Головная боль", "Панкреатит (редко)", "Артралгии"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "100 мг 1 раз в день",
      renal: "Снижать дозу до 25–50 мг по клиренсу креатинина",
    },
  },
  thiamazole: {
    atcCode: "H03BB02",
    indications: ["E05", "E06"],
    contraindications: ["Агранулоцитоз в анамнезе на тиамазол", "Тяжёлый холестаз", "Гиперчувствительность"],
    sideEffects: ["Агранулоцитоз", "Кожная сыпь", "Артралгии", "Гепатотоксичность", "Гипотиреоз при передозировке"],
    pregnancyCat: "D",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 20–40 мг/сут, поддержание 5–15 мг/сут",
    },
  },
  allopurinol: {
    atcCode: "M04AA01",
    indications: ["M10", "E79", "N20", "N22"],
    contraindications: ["Острый приступ подагры (не начинать)", "Тяжёлая почечная недостаточность (коррекция дозы)", "Гиперчувствительность"],
    sideEffects: ["Кожная сыпь (риск СДЖ/ТЭН)", "Обострение подагры в начале терапии", "Повышение трансаминаз", "Тошнота"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 100 мг/сут, поддержание 200–300 мг/сут (до 600 мг по уровню мочевой кислоты)",
      renal: "Снижать дозу по клиренсу креатинина",
    },
  },

  // ─── Урология ─────────────────────────────────────────────
  tamsulosin: {
    atcCode: "G04CA02",
    indications: ["N40", "N20", "R33"],
    contraindications: ["Ортостатическая гипотензия в анамнезе", "Тяжёлая печёночная недостаточность", "Гиперчувствительность"],
    sideEffects: ["Ортостатическая гипотензия", "Ретроградная эякуляция", "Головокружение", "Интраоперационный синдром дряблой радужки"],
    pregnancyCat: "UNKNOWN",
    rxOnly: true,
    defaultDosing: {
      adult: "0,4 мг 1 раз в день после еды",
    },
  },
  sildenafil: {
    atcCode: "G04BE03",
    indications: ["F52", "N48", "I27"],
    contraindications: ["Совместный приём нитратов", "Перенесённый инфаркт/инсульт за последние 6 мес", "Тяжёлая гипотензия", "Наследственная дегенерация сетчатки"],
    sideEffects: ["Головная боль", "Приливы", "Заложенность носа", "Нарушение цветовосприятия", "Снижение АД"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "50 мг за 1 ч до полового акта (диапазон 25–100 мг), не чаще 1 раза в сутки",
    },
  },

  // ─── Дерматология / офтальмология / антисептики ───────────
  mometasone: {
    atcCode: "D07AC13",
    indications: ["L20", "L30", "L40", "J30", "J31"],
    contraindications: ["Бактериальные, вирусные, грибковые поражения кожи", "Розацеа, периоральный дерматит", "Гиперчувствительность"],
    sideEffects: ["Жжение, зуд", "Атрофия кожи при длительном применении", "Телеангиэктазии", "Носовое кровотечение (спрей)"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Крем/мазь 1 раз в день тонким слоем; назальный спрей 2 дозы в каждый ход 1 раз в день",
    },
  },
  betamethasone: {
    atcCode: "D07AC01",
    indications: ["L20", "L30", "L40", "M05", "M06", "M65"],
    contraindications: ["Кожные инфекции", "Системные микозы", "Гиперчувствительность", "Осторожно при сахарном диабете (депо-форма)"],
    sideEffects: ["Атрофия кожи", "Стрии", "Гипергликемия (системно)", "Подавление надпочечников при длительном приёме"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Крем 1–2 раза в день; депо-форма в/м или в очаг 1 мл по показаниям",
    },
  },
  olopatadine: {
    atcCode: "S01GX09",
    indications: ["H10", "J30"],
    contraindications: ["Гиперчувствительность", "Ношение мягких контактных линз во время закапывания"],
    sideEffects: ["Жжение в глазах", "Сухость глаз", "Головная боль", "Нарушение вкуса"],
    pregnancyCat: "C",
    rxOnly: false,
    defaultDosing: {
      adult: "По 1 капле 1–2 раза в день в конъюнктивальный мешок",
    },
  },
  miramistin: {
    atcCode: "D08AJ",
    indications: ["J02", "J03", "J06", "L08", "T14", "N76", "K12"],
    contraindications: ["Гиперчувствительность"],
    sideEffects: ["Кратковременное жжение", "Аллергические реакции (редко)"],
    pregnancyCat: "UNKNOWN",
    rxOnly: false,
    defaultDosing: {
      adult: "Орошение/полоскание поражённой области 3–4 раза в день",
    },
  },

  // ─── Гематология / гемостаз ───────────────────────────────
  tranexamic: {
    atcCode: "B02AA02",
    indications: ["N92", "N93", "O46", "R04", "K92"],
    contraindications: ["Тромбозы и тромбоэмболии в анамнезе", "Субарахноидальное кровоизлияние", "Тяжёлая почечная недостаточность", "Цветовая слепота (для длительного приёма)"],
    sideEffects: ["Тошнота, диарея", "Головокружение", "Риск тромбоза", "Нарушение цветовосприятия (редко)"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "Меноррагии: 1000 мг 3 раза в день до 4 дней; в/в при остром кровотечении",
    },
  },
  rivaroxaban: {
    atcCode: "B01AF01",
    indications: ["I48", "I80", "I26", "I82"],
    contraindications: ["Активное клинически значимое кровотечение", "Тяжёлая печёночная недостаточность с коагулопатией", "Беременность, лактация"],
    sideEffects: ["Кровотечения", "Анемия", "Тошнота", "Повышение трансаминаз"],
    pregnancyCat: "C",
    rxOnly: true,
    defaultDosing: {
      adult: "Фибрилляция предсердий: 20 мг/сут с едой; ТГВ/ТЭЛА: 15 мг 2 раза в день 3 недели, затем 20 мг/сут",
      renal: "15 мг/сут при КК 15–49",
    },
  },
  warfarin: {
    atcCode: "B01AA03",
    indications: ["I48", "I80", "I26", "I82", "Z95"],
    contraindications: ["Активное кровотечение", "Беременность", "Тяжёлая неконтролируемая гипертензия", "Геморрагический инсульт в анамнезе"],
    sideEffects: ["Кровотечения", "Некроз кожи (редко)", "Алопеция", "Тератогенность"],
    pregnancyCat: "X",
    rxOnly: true,
    defaultDosing: {
      adult: "Старт 2,5–5 мг/сут, подбор по МНО (целевой 2,0–3,0)",
      elderly: "Стартовать с меньших доз, чаще контролировать МНО",
    },
  },

  // ─── Противорвотные ───────────────────────────────────────
  ondansetron: {
    atcCode: "A04AA01",
    indications: ["R11", "Z51"],
    contraindications: ["Совместный приём с апоморфином", "Врождённое удлинение QT", "Гиперчувствительность"],
    sideEffects: ["Запор", "Головная боль", "Удлинение QT", "Приливы"],
    pregnancyCat: "B",
    rxOnly: true,
    defaultDosing: {
      adult: "8 мг 2–3 раза в день внутрь или в/в",
      pediatric: "По массе тела/площади поверхности",
    },
  },

  // ─── Гинекология / гормоны ────────────────────────────────
  dydrogesterone: {
    atcCode: "G03DB01",
    indications: ["N91", "N94", "N97", "O20", "E28"],
    contraindications: ["Влагалищное кровотечение неясного генеза", "Тяжёлые заболевания печени", "Гиперчувствительность"],
    sideEffects: ["Головная боль", "Болезненность молочных желёз", "Межменструальные кровотечения", "Тошнота"],
    pregnancyCat: "UNKNOWN",
    rxOnly: true,
    defaultDosing: {
      adult: "10 мг 1–2 раза в день во 2-ю фазу цикла; при угрозе прерывания — по схеме",
    },
  },
  progesterone: {
    atcCode: "G03DA04",
    indications: ["O20", "N91", "N97", "E28", "N95"],
    contraindications: ["Тромбоэмболические нарушения", "Кровотечение неясного генеза", "Тяжёлые заболевания печени", "Рак молочной железы/половых органов"],
    sideEffects: ["Сонливость (при приёме внутрь)", "Головокружение", "Болезненность молочных желёз", "Межменструальные кровотечения"],
    pregnancyCat: "UNKNOWN",
    rxOnly: true,
    defaultDosing: {
      adult: "Внутрь или вагинально 200–400 мг/сут во 2-ю фазу цикла или по акушерским показаниям",
    },
  },

  // ─── Витамины / электролиты (дополнительно) ───────────────
  cyanocobalamin: {
    atcCode: "B03BA01",
    indications: ["D51", "D52", "G62", "G63", "E53"],
    contraindications: ["Эритремия, эритроцитоз", "Тромбоэмболия", "Гиперчувствительность"],
    sideEffects: ["Аллергические реакции", "Возбуждение", "Тахикардия", "Боль в месте инъекции"],
    pregnancyCat: "A",
    rxOnly: true,
    defaultDosing: {
      adult: "В12-дефицитная анемия: 500–1000 мкг/сут в/м 1–2 недели, затем поддержание",
    },
  },
  potassium_mg_asparaginate: {
    atcCode: "A12CC55",
    indications: ["I49", "I50", "E87", "I47"],
    contraindications: ["Гиперкалиемия, гипермагниемия", "Тяжёлая почечная недостаточность", "AV-блокада", "Болезнь Аддисона"],
    sideEffects: ["Тошнота", "Диарея", "Гиперкалиемия при передозировке", "Дискомфорт в животе"],
    pregnancyCat: "UNKNOWN",
    rxOnly: false,
    defaultDosing: {
      adult: "По 1–2 таблетки 3 раза в день после еды; в/в капельно по показаниям",
    },
  },
};
