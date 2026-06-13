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
  | "NEUROLOGICAL"
  | "PSYCHIATRIC"
  | "ANTIFUNGAL"
  | "ANTIVIRAL"
  | "HORMONAL"
  | "DERMATOLOGICAL"
  | "HEMATOLOGY"
  | "OPHTHALMIC"
  | "GYNECOLOGY"
  | "VACCINE"
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

  // ═══════════════════════════════════════════════════════════
  //  Расширенный каталог (v2) — неврологический уклон + ВОП
  // ═══════════════════════════════════════════════════════════

  // ─── Противоэпилептические ────────────────────────────────
  {
    id: "carbamazepine",
    nameRu: "Карбамазепин",
    intl: "Carbamazepine",
    brands: ["Финлепсин", "Тегретол"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["200 мг", "400 мг (ретард)", "100 мг"] },
    ],
  },
  {
    id: "valproate",
    nameRu: "Вальпроевая кислота",
    intl: "Valproic acid",
    brands: ["Депакин", "Конвулекс"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["300 мг", "500 мг (хроно)"] },
      { form: "SYRUP", doses: ["57,64 мг/мл"] },
    ],
  },
  {
    id: "lamotrigine",
    nameRu: "Ламотриджин",
    intl: "Lamotrigine",
    brands: ["Ламиктал", "Конвульсан"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["25 мг", "50 мг", "100 мг"] }],
  },
  {
    id: "levetiracetam",
    nameRu: "Леветирацетам",
    intl: "Levetiracetam",
    brands: ["Кеппра", "Леветинол"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["250 мг", "500 мг", "1000 мг"] },
      { form: "SYRUP", doses: ["100 мг/мл"] },
    ],
  },
  {
    id: "topiramate",
    nameRu: "Топирамат",
    intl: "Topiramate",
    brands: ["Топамакс", "Топсавер"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["25 мг", "50 мг", "100 мг"] },
      { form: "CAP", doses: ["15 мг", "25 мг"] },
    ],
  },
  {
    id: "gabapentin",
    nameRu: "Габапентин",
    intl: "Gabapentin",
    brands: ["Нейронтин", "Габагамма", "Конвалис"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "CAP", doses: ["300 мг", "400 мг"] },
      { form: "TAB", doses: ["600 мг", "800 мг"] },
    ],
  },
  {
    id: "pregabalin",
    nameRu: "Прегабалин",
    intl: "Pregabalin",
    brands: ["Лирика", "Прегабио"],
    category: "NEUROLOGICAL",
    forms: [{ form: "CAP", doses: ["75 мг", "150 мг", "300 мг"] }],
  },
  {
    id: "phenobarbital",
    nameRu: "Фенобарбитал",
    intl: "Phenobarbital",
    brands: ["Люминал"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["50 мг", "100 мг"] }],
  },

  // ─── Мигрень и миорелаксанты ──────────────────────────────
  {
    id: "sumatriptan",
    nameRu: "Суматриптан",
    intl: "Sumatriptan",
    brands: ["Имигран", "Сумамигрен", "Амигренин"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["50 мг", "100 мг"] },
      { form: "SPRAY", doses: ["20 мг/доза"] },
    ],
  },
  {
    id: "tolperisone",
    nameRu: "Толперизон",
    intl: "Tolperisone",
    brands: ["Мидокалм", "Калмирекс"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["50 мг", "150 мг"] },
      { form: "INJ_IM", doses: ["100 мг/мл"] },
    ],
  },
  {
    id: "tizanidine",
    nameRu: "Тизанидин",
    intl: "Tizanidine",
    brands: ["Сирдалуд", "Тизалуд"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["2 мг", "4 мг"] }],
  },
  {
    id: "baclofen",
    nameRu: "Баклофен",
    intl: "Baclofen",
    brands: ["Баклосан"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["10 мг", "25 мг"] }],
  },

  // ─── Сосудистые, ноотропы, вестибулотропики ───────────────
  {
    id: "piracetam",
    nameRu: "Пирацетам",
    intl: "Piracetam",
    brands: ["Ноотропил", "Луцетам"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["800 мг", "1200 мг"] },
      { form: "CAP", doses: ["400 мг"] },
      { form: "INJ_IV", doses: ["200 мг/мл"] },
    ],
  },
  {
    id: "citicoline",
    nameRu: "Цитиколин",
    intl: "Citicoline",
    brands: ["Цераксон", "Нейпилепт"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "INJ_IV", doses: ["500 мг/4 мл", "1000 мг/4 мл"] },
      { form: "DROPS_ORAL", doses: ["100 мг/мл"] },
    ],
  },
  {
    id: "vinpocetine",
    nameRu: "Винпоцетин",
    intl: "Vinpocetine",
    brands: ["Кавинтон"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["5 мг", "10 мг"] },
      { form: "INJ_IV", doses: ["5 мг/мл"] },
    ],
  },
  {
    id: "cinnarizine",
    nameRu: "Циннаризин",
    intl: "Cinnarizine",
    brands: ["Стугерон"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["25 мг", "75 мг"] }],
  },
  {
    id: "betahistine",
    nameRu: "Бетагистин",
    intl: "Betahistine",
    brands: ["Бетасерк", "Вестибо", "Тагиста"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["8 мг", "16 мг", "24 мг"] }],
  },
  {
    id: "mexidol",
    nameRu: "Этилметилгидроксипиридина сукцинат",
    intl: "Ethylmethylhydroxypyridine succinate",
    brands: ["Мексидол", "Мексиприм"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["125 мг"] },
      { form: "INJ_IV", doses: ["50 мг/мл"] },
    ],
  },
  {
    id: "nicergoline",
    nameRu: "Ницерголин",
    intl: "Nicergoline",
    brands: ["Сермион"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["10 мг", "30 мг"] }],
  },
  {
    id: "pentoxifylline",
    nameRu: "Пентоксифиллин",
    intl: "Pentoxifylline",
    brands: ["Трентал", "Вазонит"],
    category: "CARDIO",
    forms: [
      { form: "TAB", doses: ["100 мг", "400 мг (ретард)"] },
      { form: "INJ_IV", doses: ["20 мг/мл"] },
    ],
  },
  {
    id: "phenibut",
    nameRu: "Аминофенилмасляная кислота",
    intl: "Aminophenylbutyric acid",
    brands: ["Ноофен", "Анвифен", "Фенибут"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["250 мг"] }],
  },

  // ─── Паркинсонизм и деменция ──────────────────────────────
  {
    id: "levodopa_carbidopa",
    nameRu: "Леводопа + карбидопа",
    intl: "Levodopa + Carbidopa",
    brands: ["Наком", "Синемет", "Тидомет"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["250 мг + 25 мг", "100 мг + 25 мг"] }],
  },
  {
    id: "pramipexole",
    nameRu: "Прамипексол",
    intl: "Pramipexole",
    brands: ["Мирапекс", "Прамипекс"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["0,25 мг", "1 мг", "1,5 мг (пролонг)"] }],
  },
  {
    id: "memantine",
    nameRu: "Мемантин",
    intl: "Memantine",
    brands: ["Акатинол Мемантин", "Меманталь"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["10 мг", "20 мг"] }],
  },
  {
    id: "donepezil",
    nameRu: "Донепезил",
    intl: "Donepezil",
    brands: ["Алзепил", "Яснал"],
    category: "NEUROLOGICAL",
    forms: [{ form: "TAB", doses: ["5 мг", "10 мг"] }],
  },

  // ─── Невропатия и витамины группы B ───────────────────────
  {
    id: "milgamma",
    nameRu: "Витамины B1 + B6 + B12",
    intl: "Thiamine + Pyridoxine + Cyanocobalamin",
    brands: ["Мильгамма", "Комбилипен", "Нейробион"],
    category: "VITAMIN",
    forms: [
      { form: "INJ_IM", doses: ["2 мл"] },
      { form: "TAB", doses: ["100 мг (бенфотиамин)"] },
    ],
  },
  {
    id: "thioctic_acid",
    nameRu: "Тиоктовая кислота",
    intl: "Thioctic acid",
    brands: ["Тиоктацид", "Берлитион", "Октолипен"],
    category: "NEUROLOGICAL",
    forms: [
      { form: "TAB", doses: ["300 мг", "600 мг"] },
      { form: "INJ_IV", doses: ["300 мг/12 мл", "600 мг/24 мл"] },
    ],
  },

  // ─── Антидепрессанты ──────────────────────────────────────
  {
    id: "amitriptyline",
    nameRu: "Амитриптилин",
    intl: "Amitriptyline",
    brands: ["Саротен"],
    category: "PSYCHIATRIC",
    forms: [
      { form: "TAB", doses: ["10 мг", "25 мг"] },
      { form: "INJ_IM", doses: ["10 мг/мл"] },
    ],
  },
  {
    id: "sertraline",
    nameRu: "Сертралин",
    intl: "Sertraline",
    brands: ["Золофт", "Асентра", "Стимулотон"],
    category: "PSYCHIATRIC",
    forms: [{ form: "TAB", doses: ["50 мг", "100 мг"] }],
  },
  {
    id: "escitalopram",
    nameRu: "Эсциталопрам",
    intl: "Escitalopram",
    brands: ["Ципралекс", "Селектра", "Эленфакс"],
    category: "PSYCHIATRIC",
    forms: [{ form: "TAB", doses: ["5 мг", "10 мг", "20 мг"] }],
  },
  {
    id: "venlafaxine",
    nameRu: "Венлафаксин",
    intl: "Venlafaxine",
    brands: ["Велаксин", "Венлаксор"],
    category: "PSYCHIATRIC",
    forms: [
      { form: "TAB", doses: ["37,5 мг", "75 мг"] },
      { form: "CAP", doses: ["75 мг (пролонг)", "150 мг (пролонг)"] },
    ],
  },
  {
    id: "duloxetine",
    nameRu: "Дулоксетин",
    intl: "Duloxetine",
    brands: ["Симбалта", "Дулоксента"],
    category: "PSYCHIATRIC",
    forms: [{ form: "CAP", doses: ["30 мг", "60 мг"] }],
  },

  // ─── Анксиолитики и седативные ────────────────────────────
  {
    id: "tofisopam",
    nameRu: "Тофизопам",
    intl: "Tofisopam",
    brands: ["Грандаксин"],
    category: "PSYCHIATRIC",
    forms: [{ form: "TAB", doses: ["50 мг"] }],
  },
  {
    id: "hydroxyzine",
    nameRu: "Гидроксизин",
    intl: "Hydroxyzine",
    brands: ["Атаракс"],
    category: "PSYCHIATRIC",
    forms: [
      { form: "TAB", doses: ["25 мг"] },
      { form: "SYRUP", doses: ["2 мг/мл"] },
    ],
  },
  {
    id: "afobazole",
    nameRu: "Фабомотизол",
    intl: "Fabomotizole",
    brands: ["Афобазол"],
    category: "PSYCHIATRIC",
    forms: [{ form: "TAB", doses: ["10 мг"] }],
  },
  {
    id: "diazepam",
    nameRu: "Диазепам",
    intl: "Diazepam",
    brands: ["Реланиум", "Сибазон", "Седуксен"],
    category: "PSYCHIATRIC",
    forms: [
      { form: "TAB", doses: ["5 мг"] },
      { form: "INJ_IV", doses: ["5 мг/мл"] },
    ],
  },
  {
    id: "phenazepam",
    nameRu: "Бромдигидрохлорфенилбензодиазепин",
    intl: "Bromdihydrochlorphenylbenzodiazepine",
    brands: ["Феназепам", "Элзепам"],
    category: "PSYCHIATRIC",
    forms: [{ form: "TAB", doses: ["0,5 мг", "1 мг", "2,5 мг"] }],
  },

  // ─── Антибиотики (дополнительно) ──────────────────────────
  {
    id: "cefuroxime",
    nameRu: "Цефуроксим",
    intl: "Cefuroxime",
    brands: ["Зиннат", "Аксетин"],
    category: "ANTIBIOTIC",
    forms: [
      { form: "TAB", doses: ["250 мг", "500 мг"] },
      { form: "INJ_IM", doses: ["750 мг", "1,5 г"] },
    ],
  },
  {
    id: "nitrofurantoin",
    nameRu: "Нитрофурантоин",
    intl: "Nitrofurantoin",
    brands: ["Фурадонин"],
    category: "ANTIBIOTIC",
    forms: [{ form: "TAB", doses: ["50 мг", "100 мг"] }],
  },
  {
    id: "fosfomycin",
    nameRu: "Фосфомицин",
    intl: "Fosfomycin",
    brands: ["Монурал", "Фосфорал"],
    category: "ANTIBIOTIC",
    forms: [{ form: "POWDER", doses: ["3 г"] }],
  },
  {
    id: "co_trimoxazole",
    nameRu: "Ко-тримоксазол",
    intl: "Sulfamethoxazole + Trimethoprim",
    brands: ["Бисептол", "Бактрим"],
    category: "ANTIBIOTIC",
    forms: [
      { form: "TAB", doses: ["480 мг", "960 мг"] },
      { form: "SYRUP", doses: ["240 мг/5 мл"] },
    ],
  },
  {
    id: "moxifloxacin",
    nameRu: "Моксифлоксацин",
    intl: "Moxifloxacin",
    brands: ["Авелокс", "Вигамокс"],
    category: "ANTIBIOTIC",
    forms: [
      { form: "TAB", doses: ["400 мг"] },
      { form: "DROPS_EYE", doses: ["5 мг/мл"] },
    ],
  },
  {
    id: "gentamicin",
    nameRu: "Гентамицин",
    intl: "Gentamicin",
    category: "ANTIBIOTIC",
    forms: [
      { form: "INJ_IM", doses: ["80 мг/2 мл", "40 мг/мл"] },
      { form: "DROPS_EYE", doses: ["3 мг/мл"] },
    ],
  },

  // ─── Противогрибковые ─────────────────────────────────────
  {
    id: "fluconazole",
    nameRu: "Флуконазол",
    intl: "Fluconazole",
    brands: ["Дифлюкан", "Флюкостат", "Микосист"],
    category: "ANTIFUNGAL",
    forms: [{ form: "CAP", doses: ["50 мг", "100 мг", "150 мг"] }],
  },
  {
    id: "terbinafine",
    nameRu: "Тербинафин",
    intl: "Terbinafine",
    brands: ["Ламизил", "Тербизил", "Экзифин"],
    category: "ANTIFUNGAL",
    forms: [
      { form: "TAB", doses: ["250 мг"] },
      { form: "CREAM", doses: ["1%"] },
    ],
  },
  {
    id: "clotrimazole",
    nameRu: "Клотримазол",
    intl: "Clotrimazole",
    brands: ["Кандид", "Канестен"],
    category: "ANTIFUNGAL",
    forms: [
      { form: "CREAM", doses: ["1%"] },
      { form: "SUPP_VAG", doses: ["100 мг", "500 мг"] },
    ],
  },
  {
    id: "itraconazole",
    nameRu: "Итраконазол",
    intl: "Itraconazole",
    brands: ["Орунгал", "Ирунин", "Румикоз"],
    category: "ANTIFUNGAL",
    forms: [{ form: "CAP", doses: ["100 мг"] }],
  },

  // ─── Противовирусные ──────────────────────────────────────
  {
    id: "valacyclovir",
    nameRu: "Валацикловир",
    intl: "Valaciclovir",
    brands: ["Валтрекс", "Валвир", "Валцикон"],
    category: "ANTIVIRAL",
    forms: [{ form: "TAB", doses: ["500 мг", "1000 мг"] }],
  },
  {
    id: "oseltamivir",
    nameRu: "Осельтамивир",
    intl: "Oseltamivir",
    brands: ["Тамифлю", "Номидес"],
    category: "ANTIVIRAL",
    forms: [
      { form: "CAP", doses: ["30 мг", "45 мг", "75 мг"] },
      { form: "POWDER", doses: ["12 мг/мл"] },
    ],
  },
  {
    id: "umifenovir",
    nameRu: "Умифеновир",
    intl: "Umifenovir",
    brands: ["Арбидол"],
    category: "ANTIVIRAL",
    forms: [
      { form: "TAB", doses: ["50 мг"] },
      { form: "CAP", doses: ["100 мг", "200 мг"] },
    ],
  },

  // ─── НПВС (дополнительно) ──────────────────────────────────
  {
    id: "meloxicam",
    nameRu: "Мелоксикам",
    intl: "Meloxicam",
    brands: ["Мовалис", "Амелотекс", "Артрозан"],
    category: "NSAID",
    forms: [
      { form: "TAB", doses: ["7,5 мг", "15 мг"] },
      { form: "INJ_IM", doses: ["10 мг/мл"] },
    ],
  },
  {
    id: "naproxen",
    nameRu: "Напроксен",
    intl: "Naproxen",
    brands: ["Налгезин", "Санапрокс"],
    category: "NSAID",
    forms: [{ form: "TAB", doses: ["250 мг", "275 мг", "550 мг"] }],
  },
  {
    id: "ketoprofen",
    nameRu: "Кетопрофен",
    intl: "Ketoprofen",
    brands: ["Кетонал", "ОКИ", "Фламакс"],
    category: "NSAID",
    forms: [
      { form: "CAP", doses: ["50 мг"] },
      { form: "TAB", doses: ["100 мг", "150 мг (ретард)"] },
      { form: "INJ_IM", doses: ["50 мг/мл"] },
      { form: "GEL", doses: ["2,5%"] },
    ],
  },
  {
    id: "celecoxib",
    nameRu: "Целекоксиб",
    intl: "Celecoxib",
    brands: ["Целебрекс", "Дилакса"],
    category: "NSAID",
    forms: [{ form: "CAP", doses: ["100 мг", "200 мг"] }],
  },

  // ─── Анальгетики ──────────────────────────────────────────
  {
    id: "metamizole",
    nameRu: "Метамизол натрия",
    intl: "Metamizole sodium",
    brands: ["Анальгин", "Баралгин М"],
    category: "ANALGESIC",
    forms: [
      { form: "TAB", doses: ["500 мг"] },
      { form: "INJ_IM", doses: ["500 мг/мл"] },
    ],
  },
  {
    id: "tramadol",
    nameRu: "Трамадол",
    intl: "Tramadol",
    brands: ["Трамал"],
    category: "ANALGESIC",
    forms: [
      { form: "CAP", doses: ["50 мг"] },
      { form: "INJ_IM", doses: ["50 мг/мл"] },
    ],
  },

  // ─── Антигистаминные (дополнительно) ──────────────────────
  {
    id: "fexofenadine",
    nameRu: "Фексофенадин",
    intl: "Fexofenadine",
    brands: ["Аллегра", "Фексадин", "Фексофаст"],
    category: "ANTIHISTAMINE",
    forms: [{ form: "TAB", doses: ["120 мг", "180 мг"] }],
  },
  {
    id: "levocetirizine",
    nameRu: "Левоцетиризин",
    intl: "Levocetirizine",
    brands: ["Ксизал", "Супрастинекс", "Зодак Экспресс"],
    category: "ANTIHISTAMINE",
    forms: [
      { form: "TAB", doses: ["5 мг"] },
      { form: "DROPS_ORAL", doses: ["5 мг/мл"] },
    ],
  },

  // ─── ЖКТ (дополнительно) ──────────────────────────────────
  {
    id: "rabeprazole",
    nameRu: "Рабепразол",
    intl: "Rabeprazole",
    brands: ["Париет", "Зульбекс", "Рабиет"],
    category: "GI",
    forms: [{ form: "TAB", doses: ["10 мг", "20 мг"] }],
  },
  {
    id: "pancreatin",
    nameRu: "Панкреатин",
    intl: "Pancreatin",
    brands: ["Креон", "Мезим Форте", "Панзинорм"],
    category: "GI",
    forms: [
      { form: "CAP", doses: ["10000 ЕД", "25000 ЕД"] },
      { form: "TAB", doses: ["10000 ЕД", "3500 ЕД"] },
    ],
  },
  {
    id: "ursodeoxycholic",
    nameRu: "Урсодезоксихолевая кислота",
    intl: "Ursodeoxycholic acid",
    brands: ["Урсосан", "Урсофальк", "Урдокса"],
    category: "GI",
    forms: [
      { form: "CAP", doses: ["250 мг"] },
      { form: "TAB", doses: ["500 мг"] },
    ],
  },
  {
    id: "lactulose",
    nameRu: "Лактулоза",
    intl: "Lactulose",
    brands: ["Дюфалак", "Нормазе", "Порталак"],
    category: "GI",
    forms: [{ form: "SYRUP", doses: ["667 мг/мл"] }],
  },
  {
    id: "bismuth",
    nameRu: "Висмута трикалия дицитрат",
    intl: "Bismuth subcitrate",
    brands: ["Де-Нол", "Новобисмол"],
    category: "GI",
    forms: [{ form: "TAB", doses: ["120 мг"] }],
  },

  // ─── Кардиология (дополнительно) ──────────────────────────
  {
    id: "metoprolol",
    nameRu: "Метопролол",
    intl: "Metoprolol",
    brands: ["Эгилок", "Беталок ЗОК", "Метокард"],
    category: "CARDIO",
    forms: [
      { form: "TAB", doses: ["25 мг", "50 мг", "100 мг"] },
      { form: "INJ_IV", doses: ["1 мг/мл"] },
    ],
  },
  {
    id: "nebivolol",
    nameRu: "Небиволол",
    intl: "Nebivolol",
    brands: ["Небилет", "Бинелол", "Небиватор"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["5 мг"] }],
  },
  {
    id: "valsartan",
    nameRu: "Валсартан",
    intl: "Valsartan",
    brands: ["Диован", "Вальсакор", "Нортиван"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["80 мг", "160 мг"] }],
  },
  {
    id: "ramipril",
    nameRu: "Рамиприл",
    intl: "Ramipril",
    brands: ["Хартил", "Амприлан", "Тритаце"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["2,5 мг", "5 мг", "10 мг"] }],
  },
  {
    id: "rosuvastatin",
    nameRu: "Розувастатин",
    intl: "Rosuvastatin",
    brands: ["Крестор", "Розукард", "Мертенил"],
    category: "CARDIO",
    forms: [{ form: "TAB", doses: ["5 мг", "10 мг", "20 мг", "40 мг"] }],
  },
  {
    id: "nitroglycerin",
    nameRu: "Нитроглицерин",
    intl: "Glyceryl trinitrate",
    brands: ["Нитроминт", "Нитроспрей"],
    category: "CARDIO",
    forms: [
      { form: "TAB", doses: ["0,5 мг (под язык)"] },
      { form: "SPRAY", doses: ["0,4 мг/доза"] },
    ],
  },
  {
    id: "amiodarone",
    nameRu: "Амиодарон",
    intl: "Amiodarone",
    brands: ["Кордарон", "Амиокордин"],
    category: "CARDIO",
    forms: [
      { form: "TAB", doses: ["200 мг"] },
      { form: "INJ_IV", doses: ["50 мг/мл"] },
    ],
  },
  {
    id: "spironolactone",
    nameRu: "Спиронолактон",
    intl: "Spironolactone",
    brands: ["Верошпирон", "Спиронол"],
    category: "DIURETIC",
    forms: [{ form: "TAB", doses: ["25 мг", "50 мг", "100 мг"] }],
  },

  // ─── Дыхательная система (дополнительно) ──────────────────
  {
    id: "montelukast",
    nameRu: "Монтелукаст",
    intl: "Montelukast",
    brands: ["Сингуляр", "Монтелар", "Алмонт"],
    category: "RESPIRATORY",
    forms: [{ form: "TAB", doses: ["4 мг (жев.)", "5 мг (жев.)", "10 мг"] }],
  },
  {
    id: "budesonide",
    nameRu: "Будесонид",
    intl: "Budesonide",
    brands: ["Пульмикорт", "Тафен Назаль", "Бенакорт"],
    category: "RESPIRATORY",
    forms: [
      { form: "INHAL", doses: ["0,25 мг/мл", "0,5 мг/мл"] },
      { form: "SPRAY", doses: ["50 мкг/доза", "100 мкг/доза"] },
    ],
  },
  {
    id: "xylometazoline",
    nameRu: "Ксилометазолин",
    intl: "Xylometazoline",
    brands: ["Отривин", "Галазолин", "Тизин"],
    category: "RESPIRATORY",
    forms: [
      { form: "DROPS_NASAL", doses: ["0,05%", "0,1%"] },
      { form: "SPRAY", doses: ["0,1%"] },
    ],
  },

  // ─── Эндокринология / метаболизм (дополнительно) ──────────
  {
    id: "gliclazide",
    nameRu: "Гликлазид",
    intl: "Gliclazide",
    brands: ["Диабетон МВ", "Глидиаб", "Диабефарм"],
    category: "ENDOCRINE",
    forms: [{ form: "TAB", doses: ["30 мг (МВ)", "60 мг (МВ)", "80 мг"] }],
  },
  {
    id: "sitagliptin",
    nameRu: "Ситаглиптин",
    intl: "Sitagliptin",
    brands: ["Янувия", "Яситара"],
    category: "ENDOCRINE",
    forms: [{ form: "TAB", doses: ["25 мг", "50 мг", "100 мг"] }],
  },
  {
    id: "thiamazole",
    nameRu: "Тиамазол",
    intl: "Thiamazole",
    brands: ["Мерказолил", "Тирозол"],
    category: "ENDOCRINE",
    forms: [{ form: "TAB", doses: ["5 мг", "10 мг"] }],
  },
  {
    id: "allopurinol",
    nameRu: "Аллопуринол",
    intl: "Allopurinol",
    brands: ["Аллопуринол-ЭГИС", "Пуринол"],
    category: "ENDOCRINE",
    forms: [{ form: "TAB", doses: ["100 мг", "300 мг"] }],
  },

  // ─── Урология ─────────────────────────────────────────────
  {
    id: "tamsulosin",
    nameRu: "Тамсулозин",
    intl: "Tamsulosin",
    brands: ["Омник", "Фокусин", "Тамсулон"],
    category: "UROLOGY",
    forms: [{ form: "CAP", doses: ["0,4 мг"] }],
  },
  {
    id: "sildenafil",
    nameRu: "Силденафил",
    intl: "Sildenafil",
    brands: ["Виагра", "Силденафил-СЗ", "Динамико"],
    category: "UROLOGY",
    forms: [{ form: "TAB", doses: ["25 мг", "50 мг", "100 мг"] }],
  },

  // ─── Дерматология / офтальмология / антисептики ───────────
  {
    id: "mometasone",
    nameRu: "Мометазон",
    intl: "Mometasone",
    brands: ["Элоком", "Назонекс", "Момат"],
    category: "DERMATOLOGICAL",
    forms: [
      { form: "CREAM", doses: ["0,1%"] },
      { form: "OINT", doses: ["0,1%"] },
      { form: "SPRAY", doses: ["50 мкг/доза"] },
    ],
  },
  {
    id: "betamethasone",
    nameRu: "Бетаметазон",
    intl: "Betamethasone",
    brands: ["Целестодерм", "Дипроспан", "Акридерм"],
    category: "DERMATOLOGICAL",
    forms: [
      { form: "CREAM", doses: ["0,05%", "0,1%"] },
      { form: "INJ_IM", doses: ["7 мг/мл (депо)"] },
    ],
  },
  {
    id: "olopatadine",
    nameRu: "Олопатадин",
    intl: "Olopatadine",
    brands: ["Опатанол", "Олофрин"],
    category: "OPHTHALMIC",
    forms: [{ form: "DROPS_EYE", doses: ["1 мг/мл", "2 мг/мл"] }],
  },
  {
    id: "miramistin",
    nameRu: "Бензилдиметил-аммония хлорид",
    intl: "Benzyldimethyl ammonium chloride",
    brands: ["Мирамистин"],
    category: "TOPICAL",
    forms: [{ form: "SPRAY", doses: ["0,01%"] }],
  },

  // ─── Гематология / гемостаз ───────────────────────────────
  {
    id: "tranexamic",
    nameRu: "Транексамовая кислота",
    intl: "Tranexamic acid",
    brands: ["Транексам", "Трамикс"],
    category: "HEMATOLOGY",
    forms: [
      { form: "TAB", doses: ["250 мг", "500 мг"] },
      { form: "INJ_IV", doses: ["50 мг/мл"] },
    ],
  },
  {
    id: "rivaroxaban",
    nameRu: "Ривароксабан",
    intl: "Rivaroxaban",
    brands: ["Ксарелто"],
    category: "HEMATOLOGY",
    forms: [{ form: "TAB", doses: ["10 мг", "15 мг", "20 мг"] }],
  },
  {
    id: "warfarin",
    nameRu: "Варфарин",
    intl: "Warfarin",
    brands: ["Варфарин Никомед", "Варфарекс"],
    category: "HEMATOLOGY",
    forms: [{ form: "TAB", doses: ["2,5 мг"] }],
  },

  // ─── Противорвотные ───────────────────────────────────────
  {
    id: "ondansetron",
    nameRu: "Ондансетрон",
    intl: "Ondansetron",
    brands: ["Зофран", "Латран", "Эметрон"],
    category: "ANTIEMETIC",
    forms: [
      { form: "TAB", doses: ["4 мг", "8 мг"] },
      { form: "INJ_IV", doses: ["2 мг/мл"] },
    ],
  },

  // ─── Гинекология / гормоны ────────────────────────────────
  {
    id: "dydrogesterone",
    nameRu: "Дидрогестерон",
    intl: "Dydrogesterone",
    brands: ["Дюфастон"],
    category: "GYNECOLOGY",
    forms: [{ form: "TAB", doses: ["10 мг"] }],
  },
  {
    id: "progesterone",
    nameRu: "Прогестерон",
    intl: "Progesterone (micronized)",
    brands: ["Утрожестан", "Ипрожин"],
    category: "GYNECOLOGY",
    forms: [
      { form: "CAP", doses: ["100 мг", "200 мг"] },
      { form: "SUPP_VAG", doses: ["100 мг", "200 мг"] },
    ],
  },

  // ─── Витамины / электролиты (дополнительно) ───────────────
  {
    id: "cyanocobalamin",
    nameRu: "Цианокобаламин (B12)",
    intl: "Cyanocobalamin",
    category: "VITAMIN",
    forms: [{ form: "INJ_IM", doses: ["500 мкг/мл", "200 мкг/мл"] }],
  },
  {
    id: "potassium_mg_asparaginate",
    nameRu: "Калия и магния аспарагинат",
    intl: "Potassium + Magnesium aspartate",
    brands: ["Панангин", "Аспаркам"],
    category: "CARDIO",
    forms: [
      { form: "TAB", doses: ["1 таб."] },
      { form: "INJ_IV", doses: ["10 мл"] },
    ],
  },
];
