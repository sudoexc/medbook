/**
 * Static drug catalog — seed data for the `Drug` / `DrugBrand` tables.
 *
 * Lived in `src/lib/catalogs/drugs.ts` while the dosage builder read it at
 * runtime; since Ф2 (TZ-smart-constructor) the UI is DB-backed, so the list
 * now exists only to feed `seed-drugs.ts` (merged with `_drug-data.ts`).
 *
 * Hand-curated: the most commonly prescribed medications in Uzbekistan
 * general practice, with realistic forms and default doses per form.
 */

export type DrugForm =
  | "TAB"
  | "CAP"
  | "SYRUP"
  | "DROPS_ORAL"
  | "DROPS_NASAL"
  | "DROPS_EYE"
  | "DROPS_EAR"
  | "INJ_IM"
  | "INJ_IV"
  | "INJ_SC"
  | "OINT"
  | "CREAM"
  | "GEL"
  | "SUPP_RECT"
  | "SUPP_VAG"
  | "POWDER"
  | "INHAL"
  | "SPRAY"
  | "PATCH";

export type DrugFormVariant = {
  form: DrugForm;
  /** Suggested doses; first entry is the typical default. */
  doses: string[];
};

export type Drug = {
  /** Stable slug for lookups and analytics. */
  id: string;
  nameRu: string;
  nameUz?: string;
  /** International nonproprietary name (English/Latin), optional. */
  intl?: string;
  /** Brand alternatives the doctor might recognize. */
  brands?: string[];
  /** Group label for catalog browsing. */
  category: DrugCategory;
  forms: DrugFormVariant[];
};

export type DrugCategory =
  | "ANTIBIOTIC"
  | "ANALGESIC"
  | "ANTIPYRETIC"
  | "NSAID"
  | "ANTIHISTAMINE"
  | "GI"
  | "CARDIO"
  | "RESPIRATORY"
  | "VITAMIN"
  | "SEDATIVE"
  | "ENDOCRINE"
  | "DIURETIC"
  | "ANTIEMETIC"
  | "ANTISPASMODIC"
  | "STEROID"
  | "TOPICAL"
  | "EYE_EAR"
  | "UROLOGY"
  | "OTHER";

export const DRUGS: Drug[] = [
  // ─── Antibiotics ──────────────────────────────────────────
  {
    id: "amoxicillin",
    nameRu: "Амоксициллин",
    nameUz: "Amoksitsilin",
    intl: "Amoxicillin",
    brands: ["Флемоксин Солютаб"],
    category: "ANTIBIOTIC",
    forms: [
      { form: "CAP", doses: ["250 мг", "500 мг"] },
      { form: "TAB", doses: ["500 мг", "1000 мг"] },
      { form: "SYRUP", doses: ["125 мг/5 мл", "250 мг/5 мл"] },
    ],
  },
  {
    id: "amoxiclav",
    nameRu: "Амоксиклав",
    intl: "Amoxicillin + Clavulanate",
    brands: ["Аугментин", "Флемоклав"],
    category: "ANTIBIOTIC",
    forms: [
      { form: "TAB", doses: ["625 мг", "875 мг + 125 мг", "500 мг + 125 мг"] },
      { form: "SYRUP", doses: ["156 мг/5 мл", "228 мг/5 мл", "457 мг/5 мл"] },
    ],
  },
  {
    id: "azithromycin",
    nameRu: "Азитромицин",
    intl: "Azithromycin",
    brands: ["Сумамед", "Зитромакс"],
    category: "ANTIBIOTIC",
    forms: [
      { form: "TAB", doses: ["500 мг", "250 мг"] },
      { form: "CAP", doses: ["500 мг", "250 мг"] },
      { form: "SYRUP", doses: ["100 мг/5 мл", "200 мг/5 мл"] },
    ],
  },
  {
    id: "ciprofloxacin",
    nameRu: "Ципрофлоксацин",
    intl: "Ciprofloxacin",
    brands: ["Ципролет", "Ципринол"],
    category: "ANTIBIOTIC",
    forms: [
      { form: "TAB", doses: ["500 мг", "250 мг", "750 мг"] },
      { form: "DROPS_EYE", doses: ["3 мг/мл"] },
    ],
  },
  {
    id: "ceftriaxone",
    nameRu: "Цефтриаксон",
    intl: "Ceftriaxone",
    category: "ANTIBIOTIC",
    forms: [
      { form: "INJ_IM", doses: ["1 г", "500 мг", "2 г"] },
      { form: "INJ_IV", doses: ["1 г", "2 г"] },
    ],
  },
  {
    id: "cefixime",
    nameRu: "Цефиксим",
    intl: "Cefixime",
    brands: ["Супракс", "Цемидексор"],
    category: "ANTIBIOTIC",
    forms: [
      { form: "CAP", doses: ["400 мг"] },
      { form: "SYRUP", doses: ["100 мг/5 мл"] },
    ],
  },
  {
    id: "doxycycline",
    nameRu: "Доксициклин",
    intl: "Doxycycline",
    category: "ANTIBIOTIC",
    forms: [{ form: "CAP", doses: ["100 мг"] }],
  },
  {
    id: "metronidazole",
    nameRu: "Метронидазол",
    intl: "Metronidazole",
    brands: ["Трихопол"],
    category: "ANTIBIOTIC",
    forms: [
      { form: "TAB", doses: ["250 мг", "500 мг"] },
      { form: "INJ_IV", doses: ["500 мг/100 мл"] },
    ],
  },
  {
    id: "clarithromycin",
    nameRu: "Кларитромицин",
    intl: "Clarithromycin",
    brands: ["Клацид"],
    category: "ANTIBIOTIC",
    forms: [{ form: "TAB", doses: ["500 мг", "250 мг"] }],
  },
  {
    id: "levofloxacin",
    nameRu: "Левофлоксацин",
    intl: "Levofloxacin",
    brands: ["Таваник"],
    category: "ANTIBIOTIC",
    forms: [{ form: "TAB", doses: ["500 мг", "250 мг"] }],
  },

  // ─── Analgesic / Antipyretic ──────────────────────────────
  {
    id: "paracetamol",
    nameRu: "Парацетамол",
    nameUz: "Paratsetamol",
    intl: "Paracetamol",
    brands: ["Панадол", "Эффералган"],
    category: "ANTIPYRETIC",
    forms: [
      { form: "TAB", doses: ["500 мг", "325 мг", "1000 мг"] },
      { form: "SYRUP", doses: ["120 мг/5 мл", "250 мг/5 мл"] },
      { form: "SUPP_RECT", doses: ["125 мг", "250 мг", "500 мг"] },
    ],
  },
  {
    id: "ibuprofen",
    nameRu: "Ибупрофен",
    intl: "Ibuprofen",
    brands: ["Нурофен", "Адвил"],
    category: "NSAID",
    forms: [
      { form: "TAB", doses: ["200 мг", "400 мг", "600 мг"] },
      { form: "SYRUP", doses: ["100 мг/5 мл"] },
      { form: "SUPP_RECT", doses: ["60 мг"] },
    ],
  },
  {
    id: "nimesulide",
    nameRu: "Нимесулид",
    intl: "Nimesulide",
    brands: ["Найз", "Нимесил"],
    category: "NSAID",
    forms: [
      { form: "TAB", doses: ["100 мг"] },
      { form: "POWDER", doses: ["100 мг"] },
    ],
  },
  {
    id: "diclofenac",
    nameRu: "Диклофенак",
    intl: "Diclofenac",
    brands: ["Вольтарен"],
    category: "NSAID",
    forms: [
      { form: "TAB", doses: ["50 мг", "100 мг"] },
      { form: "INJ_IM", doses: ["75 мг/3 мл"] },
      { form: "GEL", doses: ["1%", "5%"] },
      { form: "SUPP_RECT", doses: ["50 мг", "100 мг"] },
    ],
  },
  {
    id: "ketorolac",
    nameRu: "Кеторолак",
    intl: "Ketorolac",
    brands: ["Кетанов", "Кеторол"],
    category: "ANALGESIC",
    forms: [
      { form: "TAB", doses: ["10 мг"] },
      { form: "INJ_IM", doses: ["30 мг/мл"] },
    ],
  },
  {
    id: "aspirin",
    nameRu: "Ацетилсалициловая кислота",
    intl: "Acetylsalicylic acid",
    brands: ["Аспирин"],
    category: "NSAID",
    forms: [{ form: "TAB", doses: ["500 мг", "100 мг"] }],
  },

  // ─── Antihistamines ───────────────────────────────────────
  {
    id: "loratadine",
    nameRu: "Лоратадин",
    intl: "Loratadine",
    brands: ["Кларитин"],
    category: "ANTIHISTAMINE",
    forms: [
      { form: "TAB", doses: ["10 мг"] },
      { form: "SYRUP", doses: ["5 мг/5 мл"] },
    ],
  },
  {
    id: "cetirizine",
    nameRu: "Цетиризин",
    intl: "Cetirizine",
    brands: ["Зиртек", "Зодак"],
    category: "ANTIHISTAMINE",
    forms: [
      { form: "TAB", doses: ["10 мг"] },
      { form: "DROPS_ORAL", doses: ["10 мг/мл"] },
    ],
  },
  {
    id: "chloropyramine",
    nameRu: "Хлоропирамин",
    intl: "Chloropyramine",
    brands: ["Супрастин"],
    category: "ANTIHISTAMINE",
    forms: [
      { form: "TAB", doses: ["25 мг"] },
      { form: "INJ_IM", doses: ["20 мг/мл"] },
    ],
  },
  {
    id: "desloratadine",
    nameRu: "Дезлоратадин",
    intl: "Desloratadine",
    brands: ["Эриус"],
    category: "ANTIHISTAMINE",
    forms: [
      { form: "TAB", doses: ["5 мг"] },
      { form: "SYRUP", doses: ["2,5 мг/5 мл"] },
    ],
  },

  // ─── GI ───────────────────────────────────────────────────
  {
    id: "omeprazole",
    nameRu: "Омепразол",
    intl: "Omeprazole",
    brands: ["Омез", "Лосек"],
    category: "GI",
    forms: [{ form: "CAP", doses: ["20 мг", "40 мг"] }],
  },
  {
    id: "pantoprazole",
    nameRu: "Пантопразол",
    intl: "Pantoprazole",
    brands: ["Контролок", "Нольпаза"],
    category: "GI",
    forms: [{ form: "TAB", doses: ["20 мг", "40 мг"] }],
  },
  {
    id: "famotidine",
    nameRu: "Фамотидин",
    intl: "Famotidine",
    brands: ["Квамател"],
    category: "GI",
    forms: [{ form: "TAB", doses: ["20 мг", "40 мг"] }],
  },
  {
    id: "mebeverine",
    nameRu: "Мебеверин",
    intl: "Mebeverine",
    brands: ["Дюспаталин"],
    category: "GI",
    forms: [{ form: "CAP", doses: ["200 мг"] }],
  },
  {
    id: "loperamide",
    nameRu: "Лоперамид",
    intl: "Loperamide",
    brands: ["Имодиум"],
    category: "GI",
    forms: [{ form: "CAP", doses: ["2 мг"] }],
  },
  {
    id: "smecta",
    nameRu: "Смектит диоктаэдрический",
    brands: ["Смекта"],
    category: "GI",
    forms: [{ form: "POWDER", doses: ["3 г (1 пакет)"] }],
  },
  {
    id: "simethicone",
    nameRu: "Симетикон",
    brands: ["Эспумизан"],
    category: "GI",
    forms: [
      { form: "CAP", doses: ["40 мг"] },
      { form: "DROPS_ORAL", doses: ["40 мг/мл"] },
    ],
  },
  {
    id: "nifuroxazide",
    nameRu: "Нифуроксазид",
    intl: "Nifuroxazide",
    brands: ["Энтерофурил", "Эрцефурил"],
    category: "GI",
    forms: [
      { form: "CAP", doses: ["100 мг", "200 мг"] },
      { form: "SYRUP", doses: ["200 мг/5 мл"] },
    ],
  },
  {
    id: "metoclopramide",
    nameRu: "Метоклопрамид",
    intl: "Metoclopramide",
    brands: ["Церукал"],
    category: "ANTIEMETIC",
    forms: [
      { form: "TAB", doses: ["10 мг"] },
      { form: "INJ_IM", doses: ["10 мг/2 мл"] },
    ],
  },
  {
    id: "domperidone",
    nameRu: "Домперидон",
    intl: "Domperidone",
    brands: ["Мотилиум"],
    category: "ANTIEMETIC",
    forms: [
      { form: "TAB", doses: ["10 мг"] },
      { form: "SYRUP", doses: ["5 мг/5 мл"] },
    ],
  },

  // ─── Cardio ───────────────────────────────────────────────
  {
    id: "bisoprolol",
    nameRu: "Бисопролол",
    intl: "Bisoprolol",
    brands: ["Конкор"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["2,5 мг", "5 мг", "10 мг"] }],
  },
  {
    id: "amlodipine",
    nameRu: "Амлодипин",
    intl: "Amlodipine",
    brands: ["Норваск"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["5 мг", "10 мг"] }],
  },
  {
    id: "enalapril",
    nameRu: "Эналаприл",
    intl: "Enalapril",
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["5 мг", "10 мг", "20 мг"] }],
  },
  {
    id: "losartan",
    nameRu: "Лозартан",
    intl: "Losartan",
    brands: ["Лозап"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["50 мг", "100 мг"] }],
  },
  {
    id: "lisinopril",
    nameRu: "Лизиноприл",
    intl: "Lisinopril",
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["5 мг", "10 мг", "20 мг"] }],
  },
  {
    id: "captopril",
    nameRu: "Каптоприл",
    intl: "Captopril",
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["25 мг", "50 мг"] }],
  },
  {
    id: "atorvastatin",
    nameRu: "Аторвастатин",
    intl: "Atorvastatin",
    brands: ["Липримар"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["10 мг", "20 мг", "40 мг", "80 мг"] }],
  },
  {
    id: "aspirin_cardio",
    nameRu: "Ацетилсалициловая кислота кардио",
    brands: ["Кардиомагнил", "Аспирин Кардио"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["75 мг", "100 мг"] }],
  },
  {
    id: "clopidogrel",
    nameRu: "Клопидогрел",
    intl: "Clopidogrel",
    brands: ["Плавикс"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["75 мг"] }],
  },

  // ─── Respiratory ──────────────────────────────────────────
  {
    id: "salbutamol",
    nameRu: "Сальбутамол",
    intl: "Salbutamol",
    brands: ["Вентолин"],
    category: "RESPIRATORY",
    forms: [{ form: "INHAL", doses: ["100 мкг/доза"] }],
  },
  {
    id: "berodual",
    nameRu: "Беродуал",
    intl: "Ipratropium + Fenoterol",
    category: "RESPIRATORY",
    forms: [
      { form: "INHAL", doses: ["1 доза"] },
      { form: "DROPS_ORAL", doses: ["для небулайзера"] },
    ],
  },
  {
    id: "acetylcysteine",
    nameRu: "Ацетилцистеин",
    intl: "Acetylcysteine",
    brands: ["АЦЦ"],
    category: "RESPIRATORY",
    forms: [
      { form: "POWDER", doses: ["200 мг", "600 мг"] },
      { form: "TAB", doses: ["200 мг", "600 мг"] },
    ],
  },
  {
    id: "ambroxol",
    nameRu: "Амброксол",
    intl: "Ambroxol",
    brands: ["Амбробене", "Лазолван"],
    category: "RESPIRATORY",
    forms: [
      { form: "TAB", doses: ["30 мг"] },
      { form: "SYRUP", doses: ["15 мг/5 мл", "30 мг/5 мл"] },
    ],
  },
  {
    id: "bromhexine",
    nameRu: "Бромгексин",
    intl: "Bromhexine",
    category: "RESPIRATORY",
    forms: [
      { form: "TAB", doses: ["8 мг"] },
      { form: "SYRUP", doses: ["4 мг/5 мл"] },
    ],
  },

  // ─── Antispasmodic ────────────────────────────────────────
  {
    id: "drotaverine",
    nameRu: "Дротаверин",
    intl: "Drotaverine",
    brands: ["Но-шпа"],
    category: "ANTISPASMODIC",
    forms: [
      { form: "TAB", doses: ["40 мг", "80 мг"] },
      { form: "INJ_IM", doses: ["40 мг/2 мл"] },
    ],
  },
  {
    id: "buscopan",
    nameRu: "Гиосцина бутилбромид",
    intl: "Hyoscine butylbromide",
    brands: ["Бускопан"],
    category: "ANTISPASMODIC",
    forms: [{ form: "TAB", doses: ["10 мг"] }],
  },

  // ─── Endocrine ────────────────────────────────────────────
  {
    id: "metformin",
    nameRu: "Метформин",
    intl: "Metformin",
    brands: ["Сиофор", "Глюкофаж"],
    category: "ENDOCRINE",
    forms: [{ form: "TAB", doses: ["500 мг", "850 мг", "1000 мг"] }],
  },
  {
    id: "lthyroxine",
    nameRu: "Левотироксин",
    intl: "Levothyroxine",
    brands: ["Эутирокс", "L-Тироксин"],
    category: "ENDOCRINE",
    forms: [{ form: "TAB", doses: ["25 мкг", "50 мкг", "100 мкг", "75 мкг"] }],
  },

  // ─── Diuretics ────────────────────────────────────────────
  {
    id: "furosemide",
    nameRu: "Фуросемид",
    intl: "Furosemide",
    brands: ["Лазикс"],
    category: "DIURETIC",
    forms: [
      { form: "TAB", doses: ["40 мг"] },
      { form: "INJ_IV", doses: ["20 мг/2 мл"] },
    ],
  },
  {
    id: "indapamide",
    nameRu: "Индапамид",
    intl: "Indapamide",
    brands: ["Арифон"],
    category: "DIURETIC",
    forms: [{ form: "TAB", doses: ["1,5 мг", "2,5 мг"] }],
  },

  // ─── Steroids ─────────────────────────────────────────────
  {
    id: "prednisolone",
    nameRu: "Преднизолон",
    intl: "Prednisolone",
    category: "STEROID",
    forms: [
      { form: "TAB", doses: ["5 мг"] },
      { form: "INJ_IV", doses: ["30 мг/мл"] },
    ],
  },
  {
    id: "dexamethasone",
    nameRu: "Дексаметазон",
    intl: "Dexamethasone",
    category: "STEROID",
    forms: [
      { form: "TAB", doses: ["0,5 мг"] },
      { form: "INJ_IM", doses: ["4 мг/мл"] },
    ],
  },

  // ─── Vitamins ─────────────────────────────────────────────
  {
    id: "vitamin_d3",
    nameRu: "Витамин D3 (холекальциферол)",
    brands: ["Аквадетрим", "Вигантол"],
    category: "VITAMIN",
    forms: [
      { form: "DROPS_ORAL", doses: ["500 МЕ/капля", "1000 МЕ/капля"] },
      { form: "CAP", doses: ["2000 МЕ", "5000 МЕ"] },
    ],
  },
  {
    id: "magnesium_b6",
    nameRu: "Магний B6",
    brands: ["Магне B6"],
    category: "VITAMIN",
    forms: [
      { form: "TAB", doses: ["470 мг + 5 мг"] },
      { form: "SYRUP", doses: ["100 мг/10 мл"] },
    ],
  },
  {
    id: "iron_sorbifer",
    nameRu: "Железа сульфат + аскорбиновая кислота",
    brands: ["Сорбифер Дурулес"],
    category: "VITAMIN",
    forms: [{ form: "TAB", doses: ["100 мг + 60 мг"] }],
  },
  {
    id: "folic_acid",
    nameRu: "Фолиевая кислота",
    intl: "Folic acid",
    category: "VITAMIN",
    forms: [{ form: "TAB", doses: ["1 мг", "5 мг", "400 мкг"] }],
  },

  // ─── Sedatives ────────────────────────────────────────────
  {
    id: "glycine",
    nameRu: "Глицин",
    intl: "Glycine",
    category: "SEDATIVE",
    forms: [{ form: "TAB", doses: ["100 мг"] }],
  },
  {
    id: "melatonin",
    nameRu: "Мелатонин",
    intl: "Melatonin",
    brands: ["Мелаксен"],
    category: "SEDATIVE",
    forms: [{ form: "TAB", doses: ["3 мг", "5 мг"] }],
  },

  // ─── Topical ──────────────────────────────────────────────
  {
    id: "levomekol",
    nameRu: "Левомеколь",
    category: "TOPICAL",
    forms: [{ form: "OINT", doses: ["1 туба 40 г"] }],
  },
  {
    id: "bepanten",
    nameRu: "Бепантен",
    intl: "Dexpanthenol",
    category: "TOPICAL",
    forms: [
      { form: "CREAM", doses: ["5%"] },
      { form: "OINT", doses: ["5%"] },
    ],
  },
  {
    id: "acyclovir",
    nameRu: "Ацикловир",
    intl: "Acyclovir",
    brands: ["Зовиракс"],
    category: "TOPICAL",
    forms: [
      { form: "CREAM", doses: ["5%"] },
      { form: "TAB", doses: ["200 мг", "400 мг"] },
    ],
  },

  // ─── Eye / Ear ────────────────────────────────────────────
  {
    id: "tobrex",
    nameRu: "Тобрамицин",
    intl: "Tobramycin",
    brands: ["Тобрекс"],
    category: "EYE_EAR",
    forms: [{ form: "DROPS_EYE", doses: ["3 мг/мл"] }],
  },
  {
    id: "sulfacyl",
    nameRu: "Сульфацетамид натрия",
    brands: ["Сульфацил-натрий", "Альбуцид"],
    category: "EYE_EAR",
    forms: [{ form: "DROPS_EYE", doses: ["20%", "30%"] }],
  },
  {
    id: "otipax",
    nameRu: "Лидокаин + феназон",
    brands: ["Отипакс"],
    category: "EYE_EAR",
    forms: [{ form: "DROPS_EAR", doses: ["1 флакон"] }],
  },
];
