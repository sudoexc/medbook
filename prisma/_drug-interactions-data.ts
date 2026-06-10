/**
 * Curated drug-drug interaction pairs for the CDS engine (Phase G4).
 *
 * Each entry is one directional pair (a, b). The engine queries both
 * directions, so don't duplicate the reverse. Keep pairs tight — only
 * include interactions that are clinically actionable for an outpatient
 * doctor (no theoretical-only entries). Drug ids match the static catalog
 * in `_drug-catalog.ts` / `_drug-data.ts`.
 */
export type InteractionSeed = {
  a: string;
  b: string;
  severity: "MINOR" | "MODERATE" | "MAJOR" | "CONTRAINDICATED";
  mechanism?: string;
  advice: string;
  riskDiagnoses?: string[];
};

export const DRUG_INTERACTIONS: InteractionSeed[] = [
  // ── NSAID stacking + antiplatelet/anticoagulant bleeding ────────────────
  {
    a: "ibuprofen",
    b: "diclofenac",
    severity: "MAJOR",
    mechanism: "Стэкинг НПВС → удвоение ЖКТ-/почечного риска",
    advice: "Не комбинировать НПВС между собой. Оставить один препарат.",
  },
  {
    a: "ibuprofen",
    b: "nimesulide",
    severity: "MAJOR",
    mechanism: "Стэкинг НПВС",
    advice: "Не комбинировать. Выберите один НПВС.",
  },
  {
    a: "ibuprofen",
    b: "ketorolac",
    severity: "MAJOR",
    mechanism: "Стэкинг НПВС + повышенный риск ЖКТ-кровотечения",
    advice: "Не назначать одновременно. Кеторолак — короткий курс ≤5 дней.",
  },
  {
    a: "diclofenac",
    b: "nimesulide",
    severity: "MAJOR",
    mechanism: "Стэкинг НПВС",
    advice: "Не комбинировать. Один НПВС за раз.",
  },
  {
    a: "diclofenac",
    b: "ketorolac",
    severity: "MAJOR",
    mechanism: "Стэкинг НПВС",
    advice: "Не комбинировать.",
  },
  {
    a: "nimesulide",
    b: "ketorolac",
    severity: "MAJOR",
    mechanism: "Стэкинг НПВС",
    advice: "Не комбинировать.",
  },
  {
    a: "aspirin",
    b: "ibuprofen",
    severity: "MODERATE",
    mechanism: "Ибупрофен блокирует кардиопротективный эффект низкодозовой АСК",
    advice:
      "Принимать АСК минимум за 30 мин до или через 8 ч после ибупрофена; рассмотреть парацетамол как анальгетик.",
  },
  {
    a: "aspirin_cardio",
    b: "ibuprofen",
    severity: "MODERATE",
    mechanism: "Ибупрофен снижает антиагрегантный эффект АСК-кардио",
    advice: "Назначать АСК-кардио за 30 мин до ибупрофена или сменить на парацетамол.",
  },
  {
    a: "aspirin",
    b: "clopidogrel",
    severity: "MAJOR",
    mechanism: "Двойная антиагрегантная терапия — риск кровотечений",
    advice:
      "DAPT допустима по протоколу (ИБС/стент). Вне показаний — не комбинировать. Добавить ИПП.",
  },
  {
    a: "ketorolac",
    b: "aspirin",
    severity: "MAJOR",
    mechanism: "НПВС + антиагрегант → ЖКТ-кровотечение",
    advice: "Не комбинировать. Парацетамол как альтернатива.",
  },
  {
    a: "ketorolac",
    b: "clopidogrel",
    severity: "MAJOR",
    mechanism: "Высокий риск кровотечения",
    advice: "Не комбинировать. Парацетамол как альтернатива.",
  },
  {
    a: "ibuprofen",
    b: "clopidogrel",
    severity: "MODERATE",
    mechanism: "Повышенный риск кровотечения",
    advice: "Избегать длительной комбинации. Использовать парацетамол.",
  },

  // ── RAAS stacking ───────────────────────────────────────────────────────
  {
    a: "enalapril",
    b: "lisinopril",
    severity: "CONTRAINDICATED",
    mechanism: "Стэкинг ИАПФ",
    advice: "Не назначать два ИАПФ одновременно. Выберите один.",
  },
  {
    a: "enalapril",
    b: "captopril",
    severity: "CONTRAINDICATED",
    mechanism: "Стэкинг ИАПФ",
    advice: "Не назначать два ИАПФ одновременно.",
  },
  {
    a: "lisinopril",
    b: "captopril",
    severity: "CONTRAINDICATED",
    mechanism: "Стэкинг ИАПФ",
    advice: "Не назначать два ИАПФ одновременно.",
  },
  {
    a: "enalapril",
    b: "losartan",
    severity: "MAJOR",
    mechanism: "Двойная блокада РААС → гиперкалиемия, ОПН, гипотония",
    advice: "Не комбинировать ИАПФ и АРА вне строгих показаний.",
  },
  {
    a: "lisinopril",
    b: "losartan",
    severity: "MAJOR",
    mechanism: "Двойная блокада РААС",
    advice: "Не комбинировать ИАПФ и АРА.",
  },
  {
    a: "captopril",
    b: "losartan",
    severity: "MAJOR",
    mechanism: "Двойная блокада РААС",
    advice: "Не комбинировать ИАПФ и АРА.",
  },
  {
    a: "enalapril",
    b: "ibuprofen",
    severity: "MODERATE",
    mechanism: "НПВС ↓ гипотензивный эффект, ↑ риск ОПН (особенно у пожилых)",
    advice: "Контроль АД и креатинина; ограничить курс НПВС.",
    riskDiagnoses: ["N17", "N18", "I50"],
  },
  {
    a: "lisinopril",
    b: "ibuprofen",
    severity: "MODERATE",
    mechanism: "НПВС ↓ гипотензивный эффект, ↑ риск ОПН",
    advice: "Контроль АД и креатинина; короткий курс НПВС.",
    riskDiagnoses: ["N17", "N18", "I50"],
  },
  {
    a: "losartan",
    b: "ibuprofen",
    severity: "MODERATE",
    mechanism: "НПВС ↓ гипотензивный эффект, ↑ риск ОПН",
    advice: "Контроль АД и креатинина; короткий курс НПВС.",
    riskDiagnoses: ["N17", "N18", "I50"],
  },
  {
    a: "enalapril",
    b: "diclofenac",
    severity: "MODERATE",
    mechanism: "НПВС ↓ эффект ИАПФ, риск ОПН",
    advice: "Контроль АД и креатинина.",
    riskDiagnoses: ["N17", "N18", "I50"],
  },

  // ── Diuretic stacking / electrolytes ────────────────────────────────────
  {
    a: "furosemide",
    b: "indapamide",
    severity: "MAJOR",
    mechanism: "Двойной диуретик → гипокалиемия, гипотония",
    advice: "Обычно не комбинировать. Если необходимо — контроль K и АД.",
  },

  // ── QT prolongation (macrolides + fluoroquinolones + dompiridone) ──────
  {
    a: "azithromycin",
    b: "ciprofloxacin",
    severity: "MAJOR",
    mechanism: "Удлинение QT, риск torsades",
    advice: "Не комбинировать. Выберите один антибиотик.",
  },
  {
    a: "azithromycin",
    b: "levofloxacin",
    severity: "MAJOR",
    mechanism: "Удлинение QT",
    advice: "Не комбинировать.",
  },
  {
    a: "clarithromycin",
    b: "ciprofloxacin",
    severity: "MAJOR",
    mechanism: "Удлинение QT",
    advice: "Не комбинировать.",
  },
  {
    a: "clarithromycin",
    b: "levofloxacin",
    severity: "MAJOR",
    mechanism: "Удлинение QT",
    advice: "Не комбинировать.",
  },
  {
    a: "ciprofloxacin",
    b: "levofloxacin",
    severity: "CONTRAINDICATED",
    mechanism: "Стэкинг фторхинолонов",
    advice: "Не назначать два фторхинолона одновременно.",
  },
  {
    a: "azithromycin",
    b: "clarithromycin",
    severity: "CONTRAINDICATED",
    mechanism: "Стэкинг макролидов",
    advice: "Не назначать два макролида одновременно.",
  },
  {
    a: "domperidone",
    b: "clarithromycin",
    severity: "MAJOR",
    mechanism: "Удлинение QT + ингибирование CYP3A4 ↑ концентрации домперидона",
    advice: "Не комбинировать.",
  },
  {
    a: "domperidone",
    b: "azithromycin",
    severity: "MAJOR",
    mechanism: "Удлинение QT",
    advice: "Избегать сочетания.",
  },
  {
    a: "domperidone",
    b: "ciprofloxacin",
    severity: "MAJOR",
    mechanism: "Удлинение QT",
    advice: "Избегать сочетания.",
  },
  {
    a: "metoclopramide",
    b: "domperidone",
    severity: "MAJOR",
    mechanism: "Дополнительный риск экстрапирамидных нарушений",
    advice: "Не комбинировать прокинетики.",
  },

  // ── CYP3A4 + statins ───────────────────────────────────────────────────
  {
    a: "clarithromycin",
    b: "atorvastatin",
    severity: "MAJOR",
    mechanism: "Кларитромицин ингибирует CYP3A4 → ↑ концентрации статина → рабдомиолиз",
    advice: "Прервать аторвастатин на курс кларитромицина или сменить антибиотик.",
  },

  // ── PPI + clopidogrel ──────────────────────────────────────────────────
  {
    a: "omeprazole",
    b: "clopidogrel",
    severity: "MAJOR",
    mechanism: "Омепразол ингибирует CYP2C19 → ↓ активация клопидогрела",
    advice: "Переключить ИПП на пантопразол.",
  },
  {
    a: "pantoprazole",
    b: "clopidogrel",
    severity: "MINOR",
    mechanism: "Минимальное влияние на CYP2C19",
    advice: "Допустимая комбинация; пантопразол — препарат выбора при двойной антиагрегантной терапии.",
  },

  // ── Beta-blocker + beta-agonist ────────────────────────────────────────
  {
    a: "bisoprolol",
    b: "salbutamol",
    severity: "MODERATE",
    mechanism: "β1-блокада + β2-агонист — взаимное снижение эффекта",
    advice: "Допустимо при кардиоселективном β-блокаторе; контроль ПОС и ЧСС.",
    riskDiagnoses: ["J44", "J45"],
  },
  {
    a: "bisoprolol",
    b: "berodual",
    severity: "MODERATE",
    mechanism: "β1-блокада + β2-агонист (фенотерол)",
    advice: "Контроль бронхообструкции; не назначать у пациентов с тяжёлой БА.",
    riskDiagnoses: ["J44", "J45"],
  },

  // ── Steroid + NSAID ────────────────────────────────────────────────────
  {
    a: "prednisolone",
    b: "ibuprofen",
    severity: "MODERATE",
    mechanism: "Кумулятивный риск ЖКТ-кровотечения и язвы",
    advice: "Назначить гастропротектор (ИПП). Минимизировать дозы.",
  },
  {
    a: "prednisolone",
    b: "diclofenac",
    severity: "MODERATE",
    mechanism: "Кумулятивный риск ЖКТ-кровотечения",
    advice: "Добавить ИПП; короткий курс.",
  },
  {
    a: "dexamethasone",
    b: "ibuprofen",
    severity: "MODERATE",
    mechanism: "Кумулятивный риск ЖКТ-кровотечения",
    advice: "Добавить ИПП; короткий курс.",
  },

  // ── Iron + PPI ─────────────────────────────────────────────────────────
  {
    a: "iron_sorbifer",
    b: "omeprazole",
    severity: "MINOR",
    mechanism: "↓ всасывание железа на фоне кислотосупрессии",
    advice: "Принимать препарат железа с витамином C; разделять с ИПП минимум на 4 ч.",
  },
  {
    a: "iron_sorbifer",
    b: "pantoprazole",
    severity: "MINOR",
    mechanism: "↓ всасывание железа",
    advice: "Принимать препарат железа с витамином C; разделять с ИПП.",
  },
];
