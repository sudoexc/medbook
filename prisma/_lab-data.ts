/**
 * Curated lab catalog seed (Phase G3).
 *
 * Coverage targets ~80% of outpatient orders at a small clinic — hematology,
 * basic biochemistry, lipid + thyroid + anemia panels, urine, common
 * hormones/markers. Reference ranges are conservative adult defaults with
 * sex-specific entries where the difference is clinically meaningful.
 *
 * The structure is intentionally flat so the seed script can `createMany`
 * tests, then resolve panel→test joins by code. Per-clinic overrides land in
 * G6 via a `LabTestOverlay` overlay table.
 */
export type RefRange = {
  sex?: "M" | "F";
  ageMinMo?: number;
  ageMaxMo?: number;
  low?: number;
  high?: number;
  text?: string;
};

export type LabTestSeed = {
  id: string;
  code: string;
  nameRu: string;
  nameUz?: string;
  loinc?: string;
  biomaterial:
    | "BLOOD"
    | "SERUM"
    | "PLASMA"
    | "URINE"
    | "STOOL"
    | "SALIVA"
    | "SWAB"
    | "TISSUE"
    | "CSF"
    | "SPUTUM"
    | "OTHER";
  unit?: string;
  refRanges?: RefRange[];
  turnaroundHours?: number;
  priceUzs?: number;
  commonForCodes?: string[];
  patientPrep?: string;
  sortOrder?: number;
};

export type LabPanelSeed = {
  id: string;
  code: string;
  nameRu: string;
  nameUz?: string;
  description?: string;
  testCodes: string[];
  sortOrder?: number;
};

export const LAB_TESTS: LabTestSeed[] = [
  // ─── Hematology ──────────────────────────────────────────────
  {
    id: "lab_cbc",
    code: "CBC",
    nameRu: "Общий анализ крови (ОАК)",
    nameUz: "Umumiy qon tahlili",
    loinc: "58410-2",
    biomaterial: "BLOOD",
    turnaroundHours: 4,
    priceUzs: 45000,
    commonForCodes: ["D50", "J06", "J18", "K58", "I20", "E11"],
    patientPrep: "Желательно натощак",
    sortOrder: 10,
  },
  {
    id: "lab_esr",
    code: "ESR",
    nameRu: "СОЭ (скорость оседания эритроцитов)",
    biomaterial: "BLOOD",
    unit: "мм/ч",
    refRanges: [
      { sex: "F", low: 2, high: 20 },
      { sex: "M", low: 2, high: 15 },
    ],
    turnaroundHours: 4,
    priceUzs: 25000,
    commonForCodes: ["M54", "J03", "J18"],
    sortOrder: 20,
  },
  {
    id: "lab_hgb",
    code: "HGB",
    nameRu: "Гемоглобин",
    biomaterial: "BLOOD",
    unit: "г/л",
    refRanges: [
      { sex: "F", low: 120, high: 160 },
      { sex: "M", low: 130, high: 175 },
    ],
    turnaroundHours: 4,
    priceUzs: 20000,
    commonForCodes: ["D50"],
    sortOrder: 30,
  },
  {
    id: "lab_retic",
    code: "RETIC",
    nameRu: "Ретикулоциты",
    biomaterial: "BLOOD",
    unit: "%",
    refRanges: [{ low: 0.5, high: 2.0 }],
    turnaroundHours: 8,
    priceUzs: 35000,
    commonForCodes: ["D50"],
    sortOrder: 40,
  },
  {
    id: "lab_plt",
    code: "PLT",
    nameRu: "Тромбоциты",
    biomaterial: "BLOOD",
    unit: "тыс/мкл",
    refRanges: [{ low: 150, high: 400 }],
    turnaroundHours: 4,
    priceUzs: 22000,
    sortOrder: 50,
  },
  // ─── Coagulation ─────────────────────────────────────────────
  {
    id: "lab_inr",
    code: "INR",
    nameRu: "МНО (INR)",
    biomaterial: "PLASMA",
    refRanges: [{ low: 0.8, high: 1.2 }],
    turnaroundHours: 8,
    priceUzs: 50000,
    commonForCodes: ["I50", "I20"],
    sortOrder: 60,
  },
  {
    id: "lab_aptt",
    code: "APTT",
    nameRu: "АЧТВ",
    biomaterial: "PLASMA",
    unit: "сек",
    refRanges: [{ low: 25, high: 35 }],
    turnaroundHours: 8,
    priceUzs: 45000,
    sortOrder: 70,
  },
  // ─── Biochemistry ────────────────────────────────────────────
  {
    id: "lab_glu",
    code: "GLU",
    nameRu: "Глюкоза",
    nameUz: "Glyukoza",
    biomaterial: "SERUM",
    unit: "ммоль/л",
    refRanges: [{ low: 3.9, high: 5.6 }],
    turnaroundHours: 4,
    priceUzs: 25000,
    commonForCodes: ["E11"],
    patientPrep: "Строго натощак (≥8ч)",
    sortOrder: 100,
  },
  {
    id: "lab_hba1c",
    code: "HBA1C",
    nameRu: "Гликированный гемоглобин (HbA1c)",
    biomaterial: "BLOOD",
    unit: "%",
    refRanges: [{ low: 4.0, high: 5.6 }],
    turnaroundHours: 24,
    priceUzs: 90000,
    commonForCodes: ["E11"],
    sortOrder: 110,
  },
  {
    id: "lab_alt",
    code: "ALT",
    nameRu: "АЛТ (аланинаминотрансфераза)",
    biomaterial: "SERUM",
    unit: "Ед/л",
    refRanges: [
      { sex: "F", high: 35 },
      { sex: "M", high: 45 },
    ],
    turnaroundHours: 6,
    priceUzs: 30000,
    commonForCodes: ["K21", "I50"],
    sortOrder: 120,
  },
  {
    id: "lab_ast",
    code: "AST",
    nameRu: "АСТ (аспартатаминотрансфераза)",
    biomaterial: "SERUM",
    unit: "Ед/л",
    refRanges: [
      { sex: "F", high: 31 },
      { sex: "M", high: 40 },
    ],
    turnaroundHours: 6,
    priceUzs: 30000,
    commonForCodes: ["K21", "I20"],
    sortOrder: 130,
  },
  {
    id: "lab_ggt",
    code: "GGT",
    nameRu: "ГГТ (гамма-ГТ)",
    biomaterial: "SERUM",
    unit: "Ед/л",
    refRanges: [
      { sex: "F", high: 38 },
      { sex: "M", high: 55 },
    ],
    turnaroundHours: 6,
    priceUzs: 35000,
    sortOrder: 140,
  },
  {
    id: "lab_alp",
    code: "ALP",
    nameRu: "Щелочная фосфатаза (ЩФ)",
    biomaterial: "SERUM",
    unit: "Ед/л",
    refRanges: [{ low: 40, high: 150 }],
    turnaroundHours: 6,
    priceUzs: 30000,
    sortOrder: 150,
  },
  {
    id: "lab_bil",
    code: "BIL",
    nameRu: "Билирубин общий",
    biomaterial: "SERUM",
    unit: "мкмоль/л",
    refRanges: [{ low: 3.4, high: 20.5 }],
    turnaroundHours: 6,
    priceUzs: 28000,
    commonForCodes: ["K21"],
    sortOrder: 160,
  },
  {
    id: "lab_crea",
    code: "CREA",
    nameRu: "Креатинин",
    biomaterial: "SERUM",
    unit: "мкмоль/л",
    refRanges: [
      { sex: "F", low: 53, high: 97 },
      { sex: "M", low: 62, high: 115 },
    ],
    turnaroundHours: 6,
    priceUzs: 28000,
    commonForCodes: ["I10", "E11", "N30"],
    sortOrder: 170,
  },
  {
    id: "lab_urea",
    code: "UREA",
    nameRu: "Мочевина",
    biomaterial: "SERUM",
    unit: "ммоль/л",
    refRanges: [{ low: 2.5, high: 8.3 }],
    turnaroundHours: 6,
    priceUzs: 25000,
    commonForCodes: ["I10", "N30"],
    sortOrder: 180,
  },
  {
    id: "lab_uric",
    code: "URIC",
    nameRu: "Мочевая кислота",
    biomaterial: "SERUM",
    unit: "мкмоль/л",
    refRanges: [
      { sex: "F", low: 142, high: 339 },
      { sex: "M", low: 202, high: 416 },
    ],
    turnaroundHours: 6,
    priceUzs: 32000,
    sortOrder: 190,
  },
  {
    id: "lab_alb",
    code: "ALB",
    nameRu: "Альбумин",
    biomaterial: "SERUM",
    unit: "г/л",
    refRanges: [{ low: 35, high: 52 }],
    turnaroundHours: 6,
    priceUzs: 30000,
    sortOrder: 200,
  },
  {
    id: "lab_tp",
    code: "TP",
    nameRu: "Общий белок",
    biomaterial: "SERUM",
    unit: "г/л",
    refRanges: [{ low: 64, high: 83 }],
    turnaroundHours: 6,
    priceUzs: 25000,
    sortOrder: 210,
  },
  {
    id: "lab_k",
    code: "K",
    nameRu: "Калий (K)",
    biomaterial: "SERUM",
    unit: "ммоль/л",
    refRanges: [{ low: 3.5, high: 5.1 }],
    turnaroundHours: 4,
    priceUzs: 30000,
    commonForCodes: ["I10", "I50"],
    sortOrder: 220,
  },
  {
    id: "lab_na",
    code: "NA",
    nameRu: "Натрий (Na)",
    biomaterial: "SERUM",
    unit: "ммоль/л",
    refRanges: [{ low: 136, high: 145 }],
    turnaroundHours: 4,
    priceUzs: 28000,
    commonForCodes: ["I10", "I50"],
    sortOrder: 230,
  },
  {
    id: "lab_crp",
    code: "CRP",
    nameRu: "C-реактивный белок (СРБ)",
    biomaterial: "SERUM",
    unit: "мг/л",
    refRanges: [{ high: 5 }],
    turnaroundHours: 8,
    priceUzs: 55000,
    commonForCodes: ["J18", "J03", "M54"],
    sortOrder: 240,
  },
  // ─── Lipids ──────────────────────────────────────────────────
  {
    id: "lab_chol",
    code: "CHOL",
    nameRu: "Холестерин общий",
    biomaterial: "SERUM",
    unit: "ммоль/л",
    refRanges: [{ high: 5.2 }],
    turnaroundHours: 8,
    priceUzs: 32000,
    commonForCodes: ["E78", "I20"],
    patientPrep: "Натощак (≥10ч), отказ от жирной пищи накануне",
    sortOrder: 300,
  },
  {
    id: "lab_hdl",
    code: "HDL",
    nameRu: "ЛПВП (HDL-холестерин)",
    biomaterial: "SERUM",
    unit: "ммоль/л",
    refRanges: [
      { sex: "F", low: 1.2 },
      { sex: "M", low: 1.0 },
    ],
    turnaroundHours: 8,
    priceUzs: 35000,
    commonForCodes: ["E78"],
    sortOrder: 310,
  },
  {
    id: "lab_ldl",
    code: "LDL",
    nameRu: "ЛПНП (LDL-холестерин)",
    biomaterial: "SERUM",
    unit: "ммоль/л",
    refRanges: [{ high: 3.0 }],
    turnaroundHours: 8,
    priceUzs: 35000,
    commonForCodes: ["E78", "I20"],
    sortOrder: 320,
  },
  {
    id: "lab_tg",
    code: "TG",
    nameRu: "Триглицериды",
    biomaterial: "SERUM",
    unit: "ммоль/л",
    refRanges: [{ high: 1.7 }],
    turnaroundHours: 8,
    priceUzs: 32000,
    commonForCodes: ["E78"],
    sortOrder: 330,
  },
  // ─── Thyroid + hormones ──────────────────────────────────────
  {
    id: "lab_tsh",
    code: "TSH",
    nameRu: "ТТГ (тиреотропный гормон)",
    biomaterial: "SERUM",
    unit: "мкМЕ/мл",
    refRanges: [{ low: 0.4, high: 4.0 }],
    turnaroundHours: 24,
    priceUzs: 70000,
    commonForCodes: ["E03"],
    sortOrder: 400,
  },
  {
    id: "lab_ft4",
    code: "FT4",
    nameRu: "Т4 свободный",
    biomaterial: "SERUM",
    unit: "пмоль/л",
    refRanges: [{ low: 9.0, high: 19.0 }],
    turnaroundHours: 24,
    priceUzs: 75000,
    commonForCodes: ["E03"],
    sortOrder: 410,
  },
  {
    id: "lab_ft3",
    code: "FT3",
    nameRu: "Т3 свободный",
    biomaterial: "SERUM",
    unit: "пмоль/л",
    refRanges: [{ low: 2.6, high: 5.7 }],
    turnaroundHours: 24,
    priceUzs: 75000,
    commonForCodes: ["E03"],
    sortOrder: 420,
  },
  // ─── Anemia / vitamins ───────────────────────────────────────
  {
    id: "lab_fer",
    code: "FER",
    nameRu: "Ферритин",
    biomaterial: "SERUM",
    unit: "нг/мл",
    refRanges: [
      { sex: "F", low: 13, high: 150 },
      { sex: "M", low: 30, high: 400 },
    ],
    turnaroundHours: 24,
    priceUzs: 95000,
    commonForCodes: ["D50"],
    sortOrder: 500,
  },
  {
    id: "lab_b12",
    code: "B12",
    nameRu: "Витамин B12",
    biomaterial: "SERUM",
    unit: "пг/мл",
    refRanges: [{ low: 191, high: 663 }],
    turnaroundHours: 24,
    priceUzs: 110000,
    sortOrder: 510,
  },
  {
    id: "lab_fol",
    code: "FOL",
    nameRu: "Фолаты (Vit B9)",
    biomaterial: "SERUM",
    unit: "нг/мл",
    refRanges: [{ low: 3.0, high: 17.0 }],
    turnaroundHours: 24,
    priceUzs: 95000,
    sortOrder: 520,
  },
  {
    id: "lab_vitd",
    code: "VITD",
    nameRu: "25-OH Витамин D",
    biomaterial: "SERUM",
    unit: "нг/мл",
    refRanges: [{ low: 30, high: 100 }],
    turnaroundHours: 48,
    priceUzs: 130000,
    sortOrder: 530,
  },
  // ─── Urine + stool ───────────────────────────────────────────
  {
    id: "lab_oam",
    code: "OAM",
    nameRu: "Общий анализ мочи (ОАМ)",
    nameUz: "Umumiy siydik tahlili",
    biomaterial: "URINE",
    turnaroundHours: 4,
    priceUzs: 30000,
    commonForCodes: ["N30", "E11"],
    patientPrep: "Утренняя порция, средняя струя, чистая ёмкость",
    sortOrder: 600,
  },
  {
    id: "lab_microalb",
    code: "MALB",
    nameRu: "Микроальбумин в моче",
    biomaterial: "URINE",
    unit: "мг/л",
    refRanges: [{ high: 20 }],
    turnaroundHours: 24,
    priceUzs: 55000,
    commonForCodes: ["E11", "I10"],
    sortOrder: 610,
  },
  {
    id: "lab_coprogr",
    code: "COPRO",
    nameRu: "Копрограмма",
    biomaterial: "STOOL",
    turnaroundHours: 24,
    priceUzs: 45000,
    commonForCodes: ["K58"],
    sortOrder: 700,
  },
  {
    id: "lab_helico",
    code: "HELICO",
    nameRu: "H. pylori (антитела IgG)",
    biomaterial: "SERUM",
    unit: "Ед/мл",
    refRanges: [{ text: "<0.9 — отрицательно" }],
    turnaroundHours: 24,
    priceUzs: 80000,
    commonForCodes: ["K21", "K29"],
    sortOrder: 710,
  },
];

export const LAB_PANELS: LabPanelSeed[] = [
  {
    id: "panel_cbc",
    code: "PANEL_CBC",
    nameRu: "Общий анализ крови развёрнутый",
    description: "CBC + СОЭ + ретикулоциты — стартовый скрининг.",
    testCodes: ["CBC", "ESR", "RETIC"],
    sortOrder: 10,
  },
  {
    id: "panel_biochem",
    code: "PANEL_BIOCHEM_BASIC",
    nameRu: "Биохимия базовая",
    description:
      "Glu / ALT / AST / Билирубин / Креатинин / Мочевина — обзорная панель.",
    testCodes: ["GLU", "ALT", "AST", "BIL", "CREA", "UREA"],
    sortOrder: 20,
  },
  {
    id: "panel_lipid",
    code: "PANEL_LIPID",
    nameRu: "Липидограмма",
    description: "Холестерин + ЛПНП + ЛПВП + Триглицериды.",
    testCodes: ["CHOL", "HDL", "LDL", "TG"],
    sortOrder: 30,
  },
  {
    id: "panel_thyroid",
    code: "PANEL_THYROID",
    nameRu: "Щитовидная железа",
    description: "ТТГ + Т4 свободный + Т3 свободный.",
    testCodes: ["TSH", "FT4", "FT3"],
    sortOrder: 40,
  },
  {
    id: "panel_anemia",
    code: "PANEL_ANEMIA",
    nameRu: "Анемия — углублённая",
    description: "Гемоглобин + ферритин + B12 + фолаты + ретикулоциты.",
    testCodes: ["HGB", "FER", "B12", "FOL", "RETIC"],
    sortOrder: 50,
  },
  {
    id: "panel_diabetes",
    code: "PANEL_DIABETES",
    nameRu: "Сахарный диабет — контроль",
    description: "Глюкоза + HbA1c + микроальбумин + креатинин.",
    testCodes: ["GLU", "HBA1C", "MALB", "CREA"],
    sortOrder: 60,
  },
  {
    id: "panel_liver",
    code: "PANEL_LIVER",
    nameRu: "Печень — функциональные пробы",
    description: "АЛТ + АСТ + ГГТ + ЩФ + Билирубин + Альбумин.",
    testCodes: ["ALT", "AST", "GGT", "ALP", "BIL", "ALB"],
    sortOrder: 70,
  },
  {
    id: "panel_urine",
    code: "PANEL_URINE_BASIC",
    nameRu: "Моча — базовый скрининг",
    description: "ОАМ + микроальбумин.",
    testCodes: ["OAM", "MALB"],
    sortOrder: 80,
  },
];
