/**
 * Diagnosis contraindications for the CDS engine (audit G4-03).
 *
 * The catalog already says, drug by drug, which conditions rule it out
 * (`Drug.contraindications`, plain Russian lines taken from the SmPC / RLS
 * label): metoclopramide «Эпилепсия», sumatriptan «Цереброваскулярные
 * нарушения (инсульт/ТИА)» and «ИБС, инфаркт миокарда в анамнезе», tramadol
 * «Неконтролируемая эпилепсия». The engine never read them, so a G40 patient
 * got metoclopramide and a patient after a TIA got sumatriptan under a green
 * «Конфликтов не найдено».
 *
 * This module adds no clinical rule of its own. It maps the WORDING of a
 * catalog line to the ICD-10 codes of that same condition, so the catalog's
 * own line can be compared with the visit diagnosis and the patient's
 * recorded diagnoses. Every condition names the ICD-10 block its codes come
 * from. Lines that cannot be tied to a code without guessing are left alone
 * on purpose:
 *   - «Неврологические заболевания» (metronidazole): every patient of a
 *     neurology clinic has one, the line would fire on every visit;
 *   - «Гемиплегическая и базилярная мигрень» (triptans): WHO ICD-10 files
 *     them under G43.1 together with every migraine with aura, the very
 *     patients triptans are prescribed for;
 *   - феохромоцитома: D35.0 is every benign adrenal tumour;
 *   - QT prolongation, active bleeding, shock, age, pregnancy,
 *     hypersensitivity: not a code on the card, or checked elsewhere
 *     (pregnancy.ts, allergy-match.ts).
 *
 * A qualified line («Неконтролируемая …», «Тяжёлая …», «… в обострении»,
 * «(осторожно)») cannot be confirmed from a code alone: it warns one step
 * softer and asks the doctor to check. Warnings are Russian, like the rest
 * of the engine's text (they are stored verbatim in CdsOverride snapshots).
 *
 * JS `\b` only knows Latin letters, so Cyrillic whole words are bounded
 * with lookarounds on `[а-я]` instead.
 */
import type { CdsSeverity } from "./drug-check";

type Condition = {
  key: string;
  /** Russian name of the condition, used in the warning title. */
  labelRu: string;
  /** Matches the catalog's wording. Run on text folded by `fold()`. */
  pattern: RegExp;
  /** Lines of that wording that are about something else. */
  exclude?: RegExp;
  /**
   * How a patient record WITHOUT a matching code names the condition, when
   * that must be stricter than the catalog wording: «Инфаркт мозга» is a
   * stroke, not the «инфаркт» of a heart line, and «ХЦВН» is not the
   * «цереброваскулярные нарушения (инсульт/ТИА)» of a triptan label.
   * `null`: a record counts only by its code. Defaults to `pattern`.
   */
  recordPattern?: RegExp | null;
  /** ICD-10 prefixes of the condition. */
  icd: string[];
  /**
   * Lines of one group describe overlapping conditions («инсульт» and
   * «геморрагический инсульт»): a line takes the first match in its group.
   */
  group?: string;
  /** Where the codes come from. Not shown in the UI. */
  source: string;
};

/** Lowercase, ё→е: the catalog writes both «тяжёлая» and «тяжелая». */
function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

export const CONTRAINDICATION_CONDITIONS: Condition[] = [
  // ── Nervous system ────────────────────────────────────────────────────
  {
    // «Эпилепсия, судороги в анамнезе» on the label; a record of leg cramps
    // («судороги икроножных мышц») is not epilepsy.
    key: "EPILEPSY",
    labelRu: "эпилепсия",
    pattern: /эпилеп|судорог/,
    recordPattern: /эпилеп/,
    icd: ["G40", "G41"],
    source: "ICD-10 G40 epilepsy, G41 status epilepticus",
  },
  {
    key: "HEMORRHAGIC_STROKE",
    labelRu: "геморрагический инсульт",
    pattern: /геморрагическ\S* инсульт|субарахноид|внутримозгов\S* кровоизлиян/,
    icd: ["I60", "I61", "I62", "I69.0", "I69.1", "I69.2"],
    group: "stroke",
    source: "ICD-10 I60–I62 intracranial haemorrhage, I69.0–I69.2 their sequelae",
  },
  {
    // «Цереброваскулярные нарушения (инсульт/ТИА)»: the line itself names
    // stroke and TIA, so chronic cerebrovascular disease without either
    // (I65–I67, the everyday «ХЦВН», «хроническая ишемия мозга») stays out.
    key: "STROKE_TIA",
    labelRu: "инсульт или ТИА",
    pattern: /цереброваскуляр|инсульт|(?<![а-я])тиа(?![а-я])|транзиторн\S* ишем/,
    recordPattern:
      /инсульт|(?<![а-я])тиа(?![а-я])|транзиторн\S* ишем|инфаркт\S* (головного )?мозг/,
    icd: ["I60", "I61", "I62", "I63", "I64", "I69", "G45", "G46"],
    group: "stroke",
    source: "ICD-10 I60–I64 stroke, I69 sequelae, G45 TIA, G46 vascular brain syndromes",
  },
  {
    key: "PARKINSONISM",
    labelRu: "паркинсонизм",
    pattern: /паркинсон/,
    icd: ["G20", "G21", "G22"],
    source: "ICD-10 G20–G22 Parkinson disease and parkinsonism",
  },
  {
    key: "MYASTHENIA",
    labelRu: "миастения",
    pattern: /миастени/,
    icd: ["G70"],
    source: "ICD-10 G70 myasthenia gravis",
  },
  {
    key: "HUNTINGTON",
    labelRu: "хорея Гентингтона",
    pattern: /хоре\S* гентингтон/,
    icd: ["G10"],
    source: "ICD-10 G10 Huntington disease",
  },
  {
    key: "POLYNEUROPATHY",
    labelRu: "полинейропатия",
    pattern: /полинейропат|полиневропат/,
    icd: ["G60", "G61", "G62", "G63", "G64"],
    source: "ICD-10 G60–G64 polyneuropathies",
  },
  {
    key: "SLEEP_APNEA",
    labelRu: "синдром апноэ во сне",
    pattern: /апноэ/,
    icd: ["G47.3"],
    source: "ICD-10 G47.3 sleep apnoea",
  },
  {
    key: "PSYCHOSIS",
    labelRu: "психоз",
    pattern: /психоз/,
    icd: ["F20", "F21", "F22", "F23", "F24", "F25", "F28", "F29"],
    source: "ICD-10 F20–F29 schizophrenia and psychotic disorders",
  },
  {
    // A typed «метеозависимость» is not a dependence syndrome: by code only.
    key: "DEPENDENCE",
    labelRu: "зависимость",
    pattern: /зависимост/,
    recordPattern: null,
    icd: ["F10.2", "F11.2", "F12.2", "F13.2", "F14.2", "F15.2", "F16.2", "F18.2", "F19.2"],
    source: "ICD-10 F1x.2 dependence syndrome",
  },

  // ── Heart and vessels ─────────────────────────────────────────────────
  {
    key: "MI_ACUTE",
    labelRu: "острый инфаркт миокарда",
    pattern: /остр\S*.*инфаркт|инфаркт.*остр/,
    exclude: /ибс|ишемическ\S* болезн/,
    recordPattern: /инфаркт\S* миокард/,
    icd: ["I21", "I22"],
    group: "heart",
    source: "ICD-10 I21–I22 acute myocardial infarction",
  },
  {
    key: "MI",
    labelRu: "инфаркт миокарда",
    pattern: /инфаркт/,
    exclude: /ибс|ишемическ\S* болезн/,
    recordPattern: /инфаркт\S* миокард/,
    icd: ["I21", "I22", "I25.2"],
    group: "heart",
    source: "ICD-10 I21–I22 acute myocardial infarction, I25.2 old infarction",
  },
  {
    key: "IHD",
    labelRu: "ИБС",
    pattern: /(?<![а-я])ибс(?![а-я])|ишемическ\S* болезн\S* сердц|стенокард/,
    icd: ["I20", "I21", "I22", "I23", "I24", "I25"],
    group: "heart",
    source: "ICD-10 I20–I25 ischaemic heart diseases",
  },
  {
    key: "HEART_FAILURE",
    labelRu: "сердечная недостаточность",
    pattern: /(?<![а-я])хсн(?![а-я])|сердечн\S*[ ,/].*недостаточн/,
    icd: ["I50"],
    source: "ICD-10 I50 heart failure",
  },
  {
    // «Блокада ножки пучка Гиса» on a card is not the AV block of a label.
    key: "CONDUCTION",
    labelRu: "AV-блокада или СССУ",
    pattern: /блокад|сссу|слабост\S* синусов|нарушени\S* проводимост/,
    recordPattern:
      /(av|ав).?блокад|атриовентрикулярн\S* блокад|сссу|слабост\S* синусов/,
    // First degree AV block (I44.0) is benign and no label means it.
    icd: ["I44.1", "I44.2", "I44.3", "I49.5"],
    source: "ICD-10 I44.1–I44.3 AV block 2nd/3rd degree, I49.5 sick sinus syndrome",
  },
  {
    key: "BRADYCARDIA",
    labelRu: "брадикардия",
    pattern: /брадикард/,
    icd: ["R00.1"],
    source: "ICD-10 R00.1 bradycardia",
  },
  {
    // «Синдром внутричерепной гипертензии» is a neurology diagnosis in its
    // own right, not arterial hypertension.
    key: "HYPERTENSION",
    labelRu: "артериальная гипертензия",
    pattern: /гипертензи|гипертони/,
    exclude: /внутричереп|ликвор|интракраниал|портальн|легочн/,
    icd: ["I10", "I11", "I12", "I13", "I15"],
    source: "ICD-10 I10–I15 hypertensive diseases",
  },
  {
    // «Мышечная гипотония» is a neurological sign, not blood pressure.
    key: "HYPOTENSION",
    labelRu: "артериальная гипотензия",
    pattern: /гипотензи|гипотони/,
    exclude: /мышечн/,
    icd: ["I95"],
    source: "ICD-10 I95 hypotension",
  },
  {
    key: "THROMBOEMBOLISM",
    labelRu: "тромбоз или тромбоэмболия",
    pattern: /тромбоз|тромбоэмбол/,
    exclude: /геморро/,
    icd: ["I26", "I74", "I80", "I81", "I82"],
    source: "ICD-10 I26 pulmonary embolism, I74 arterial embolism, I80–I82 venous thrombosis",
  },
  {
    key: "RENAL_ARTERY_STENOSIS",
    labelRu: "стеноз почечных артерий",
    pattern: /стеноз\S* почечн/,
    icd: ["I70.1", "I15.0"],
    source: "ICD-10 I70.1 renal artery atherosclerosis, I15.0 renovascular hypertension",
  },

  // ── Lungs, gut, liver, kidneys ────────────────────────────────────────
  {
    // «с непереносимостью НПВС» / «аспириновая» describe a drug reaction,
    // which is the allergy check's business, not a diagnosis.
    key: "ASTHMA",
    labelRu: "бронхиальная астма",
    pattern: /астм/,
    exclude: /нпвс|аспирин/,
    icd: ["J45", "J46"],
    source: "ICD-10 J45 asthma, J46 status asthmaticus",
  },
  {
    key: "PEPTIC_ULCER",
    labelRu: "язвенная болезнь",
    pattern: /язвенн\S* болезн|язв\S* желудк|язв\S* двенадцат/,
    icd: ["K25", "K26", "K27", "K28"],
    source: "ICD-10 K25–K28 gastric and duodenal ulcer",
  },
  {
    key: "GI_BLEEDING",
    labelRu: "желудочно-кишечное кровотечение",
    pattern: /жкт.кровотеч|желудочно.кишечн\S* кровотеч/,
    icd: ["K92.0", "K92.1", "K92.2"],
    source: "ICD-10 K92.0–K92.2 haematemesis, melaena, GI haemorrhage",
  },
  {
    key: "BOWEL_OBSTRUCTION",
    labelRu: "кишечная непроходимость",
    pattern: /непроходимост/,
    recordPattern: /кишечн\S* непроходимост/,
    icd: ["K56"],
    source: "ICD-10 K56 paralytic ileus and intestinal obstruction",
  },
  {
    key: "PANCREATITIS",
    labelRu: "панкреатит",
    pattern: /панкреатит/,
    icd: ["K85", "K86.0", "K86.1"],
    source: "ICD-10 K85 acute, K86.0–K86.1 chronic pancreatitis",
  },
  {
    // Clavulanate's «печёночная дисфункция в анамнезе при приёме
    // клавуланата» is a past drug reaction, not a liver diagnosis. A typed
    // «жировой гепатоз печени» is not the liver disease the labels mean.
    key: "LIVER",
    labelRu: "заболевание печени",
    pattern: /печен|цирроз/,
    exclude: /клавуланат/,
    recordPattern: /цирроз|гепатит|печеночн\S* недостаточн|фиброз\S* печен/,
    icd: ["K70", "K71", "K72", "K73", "K74", "K75", "B18"],
    source: "ICD-10 K70–K75 liver diseases, B18 chronic viral hepatitis",
  },
  {
    // «Надпочечниковая недостаточность» is the adrenal gland, hence the
    // lookbehind.
    key: "RENAL_FAILURE",
    labelRu: "почечная недостаточность",
    pattern: /(?<![а-я])почечн\S*[ ,/].*недостаточн|анури/,
    recordPattern:
      /(?<![а-я])почечн\S* недостаточн|(?<![а-я])хбп(?![а-я])|хроническ\S* болезн\S* почек|анури/,
    icd: ["N17", "N18", "N19"],
    source: "ICD-10 N17–N19 renal failure",
  },
  {
    key: "KIDNEY_STONES",
    labelRu: "мочекаменная болезнь",
    pattern: /нефролитиаз|мочекаменн/,
    icd: ["N20"],
    source: "ICD-10 N20 calculus of kidney and ureter",
  },
  {
    key: "PROSTATE",
    labelRu: "гиперплазия простаты",
    pattern: /аденом\S* простат|гиперплази\S* простат/,
    icd: ["N40"],
    source: "ICD-10 N40 hyperplasia of prostate",
  },

  // ── Endocrine, blood, other ───────────────────────────────────────────
  {
    key: "PORPHYRIA",
    labelRu: "порфирия",
    pattern: /порфири/,
    // E80.4–E80.7 are bilirubin disorders (Gilbert), not porphyria.
    icd: ["E80.0", "E80.1", "E80.2"],
    source: "ICD-10 E80.0–E80.2 porphyrias",
  },
  {
    key: "ADRENAL_INSUFFICIENCY",
    labelRu: "надпочечниковая недостаточность",
    pattern: /аддисон|надпочечников\S* недостаточн/,
    icd: ["E27.1", "E27.2", "E27.4"],
    source: "ICD-10 E27.1–E27.4 adrenocortical insufficiency",
  },
  {
    key: "THYROTOXICOSIS",
    labelRu: "тиреотоксикоз",
    pattern: /тиреотоксикоз/,
    icd: ["E05"],
    group: "thyroid",
    source: "ICD-10 E05 thyrotoxicosis",
  },
  {
    key: "THYROID",
    labelRu: "заболевание щитовидной железы",
    pattern: /щитовидн/,
    icd: ["E00", "E01", "E02", "E03", "E04", "E05", "E06", "E07"],
    group: "thyroid",
    source: "ICD-10 E00–E07 disorders of thyroid gland",
  },
  {
    key: "DIABETES_T1",
    labelRu: "сахарный диабет 1 типа",
    pattern: /диабет\S* 1 тип/,
    icd: ["E10"],
    group: "diabetes",
    source: "ICD-10 E10 type 1 diabetes mellitus",
  },
  {
    key: "DIABETES",
    labelRu: "сахарный диабет",
    pattern: /сахарн\S* диабет/,
    icd: ["E10", "E11", "E13", "E14"],
    group: "diabetes",
    source: "ICD-10 E10–E14 diabetes mellitus",
  },
  {
    key: "G6PD",
    labelRu: "дефицит Г6ФД",
    pattern: /г6фд|глюкозо.6.фосфатдегидрогеназ/,
    icd: ["D55.0"],
    source: "ICD-10 D55.0 anaemia due to G6PD deficiency",
  },
  {
    // «Агранулоцитоз в анамнезе на тиамазол» is a past drug reaction.
    key: "MARROW_SUPPRESSION",
    labelRu: "угнетение кроветворения",
    pattern: /агранулоцитоз|угнетени\S* (костномозгов\S* )?кроветворени/,
    exclude: /на тиамазол/,
    icd: ["D61", "D70"],
    source: "ICD-10 D61 aplastic anaemia, D70 agranulocytosis",
  },
  {
    key: "HEMORRHAGIC_DIATHESIS",
    labelRu: "геморрагический диатез",
    pattern: /геморрагическ\S* (диатез|нарушени)/,
    icd: ["D65", "D66", "D67", "D68", "D69"],
    source: "ICD-10 D65–D69 coagulation defects, purpura",
  },
  {
    key: "ERYTHROCYTOSIS",
    labelRu: "эритремия или эритроцитоз",
    pattern: /эритреми|эритроцитоз/,
    icd: ["D45", "D75.1"],
    source: "ICD-10 D45 polycythaemia vera, D75.1 secondary polycythaemia",
  },
  {
    // Hyperprolactinaemia alone (E22.1) is not the tumour the label means.
    key: "PROLACTIN_TUMOUR",
    labelRu: "пролактинома",
    pattern: /пролактин/,
    recordPattern: /пролактином|аденом\S* гипофиз/,
    icd: ["D35.2"],
    source: "ICD-10 D35.2 benign neoplasm of pituitary gland",
  },
  {
    key: "MELANOMA",
    labelRu: "меланома",
    pattern: /меланом/,
    icd: ["C43", "D03"],
    source: "ICD-10 C43 melanoma, D03 melanoma in situ",
  },
  {
    // Every glaucoma line in the catalog is about angle closure (the drug
    // widens the pupil); open-angle glaucoma (H40.1) is not meant.
    key: "ANGLE_CLOSURE_GLAUCOMA",
    labelRu: "закрытоугольная глаукома",
    pattern: /глауком/,
    recordPattern: /закрытоугольн\S* глауком|глауком\S* закрытоугольн/,
    icd: ["H40.2"],
    source: "ICD-10 H40.2 primary angle-closure glaucoma",
  },
  {
    key: "ACOUSTIC_NEURITIS",
    labelRu: "неврит слухового нерва",
    pattern: /слухов\S* нерв/,
    icd: ["H93.3"],
    source: "ICD-10 H93.3 disorders of acoustic nerve",
  },
  {
    key: "MONONUCLEOSIS",
    labelRu: "инфекционный мононуклеоз",
    pattern: /мононуклеоз/,
    icd: ["B27"],
    source: "ICD-10 B27 infectious mononucleosis",
  },
  {
    key: "TUBERCULOSIS",
    labelRu: "туберкулёз",
    pattern: /туберкулез/,
    icd: ["A15", "A16", "A17", "A18", "A19"],
    source: "ICD-10 A15–A19 tuberculosis",
  },
  {
    // «Тяжёлая миопатия в анамнезе на статинах» is a past drug reaction;
    // a cardiomyopathy is the heart, hence the lookbehind.
    key: "MYOPATHY",
    labelRu: "миопатия",
    pattern: /(?<![а-я])миопат/,
    exclude: /статин/,
    icd: ["G71", "G72"],
    source: "ICD-10 G71 primary disorders of muscles, G72 other myopathies",
  },
  {
    key: "HYPERKALEMIA",
    labelRu: "гиперкалиемия",
    pattern: /гиперкалием/,
    icd: ["E87.5"],
    source: "ICD-10 E87.5 hyperkalaemia",
  },
  {
    key: "HYPOKALEMIA",
    labelRu: "гипокалиемия",
    pattern: /гипокалием/,
    icd: ["E87.6"],
    source: "ICD-10 E87.6 hypokalaemia",
  },
  {
    key: "HYPERCALCEMIA",
    labelRu: "гиперкальциемия",
    pattern: /гиперкальцием/,
    icd: ["E83.5"],
    source: "ICD-10 E83.5 disorders of calcium metabolism",
  },
  {
    key: "HEMOCHROMATOSIS",
    labelRu: "гемохроматоз",
    pattern: /гемохроматоз|гемосидероз/,
    icd: ["E83.1"],
    source: "ICD-10 E83.1 disorders of iron metabolism",
  },
  {
    key: "ANGIOEDEMA",
    labelRu: "ангионевротический отёк",
    pattern: /ангионевротическ|ангиоотек/,
    icd: ["T78.3", "D84.1"],
    source: "ICD-10 T78.3 angioneurotic oedema, D84.1 C1 esterase inhibitor defect",
  },
];

/**
 * Words that make a line conditional: the code alone cannot tell whether
 * the patient's condition is uncontrolled, severe, acute or bilateral, and
 * «(осторожно)» is a caution, not a ban.
 */
const QUALIFIER =
  /неконтролируем|тяжел|выраженн|(?<![а-я])остр|обострени|активн|декомпенс|осторожн|для высоких доз|коррекци|двусторонн|с задержкой|за последние|оксалат|жевательн|депо|нестабильн|массивн/;

/** The conditions one catalog line names, at most one per group. */
export function conditionsOfLine(line: string): Condition[] {
  const text = fold(line);
  const out: Condition[] = [];
  const groups = new Set<string>();
  for (const c of CONTRAINDICATION_CONDITIONS) {
    if (c.group && groups.has(c.group)) continue;
    if (!c.pattern.test(text)) continue;
    if (c.exclude?.test(text)) continue;
    out.push(c);
    if (c.group) groups.add(c.group);
  }
  return out;
}

export function isQualifiedLine(line: string): boolean {
  return QUALIFIER.test(fold(line));
}

/** Where a patient's condition is recorded; worded in the warning. */
export type PatientConditionOrigin = "VISIT" | "DIAGNOSIS" | "CHRONIC";

/**
 * One condition the patient has on record: an ICD-10 code, the words of a
 * record, or both.
 */
export type PatientCondition = {
  code: string | null;
  label: string | null;
  origin: PatientConditionOrigin;
};

const ICD_CODE = /\b([A-TV-Z]\d{2}(?:\.\d{1,2})?)\b/;

/**
 * The ICD-10 code a free-text record carries, if any. «В хронические» from
 * the visit screen writes «МКБ-10: G40.9» into the notes; a nurse may type
 * the code into the name.
 */
export function icdCodeIn(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = t ? ICD_CODE.exec(t.toUpperCase()) : null;
    if (m) return m[1]!;
  }
  return null;
}

function normCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * The record's code when it has the shape of one. The card's code field is
 * free text: a stray word typed there must not silence the record's words.
 */
function codeOf(record: PatientCondition): string | null {
  const code = record.code ? normCode(record.code) : "";
  return /^[A-TV-Z]\d{2}/.test(code) ? code : null;
}

/**
 * A word that denies what follows it within two words: «без ХСН», «без
 * (застойной) сердечной недостаточности», «при отсутствии диагноза
 * гипертензии», «исключена эпилепсия». «Не исключена …» means it may well
 * be there, so it is not a denial. Tested on the part of the clause before
 * the match; a comma, semicolon or full stop starts a new clause.
 */
const DENIED =
  /(?<![а-я])(?:без|нет|при отсутствии|отсутствует|(?<!не )исключен[а-я]*)(?:\s+\S+){0,2}\s*$/;

/** The words of the clause `text` is in, up to `index`. */
function clauseBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(...[",", ";", ".", "\n"].map((p) => before.lastIndexOf(p)));
  return before.slice(start + 1);
}

/** Does `words` name the condition somewhere in `text` without a denial? */
function namesAffirmed(text: string, words: RegExp): boolean {
  const all = new RegExp(words.source, words.flags.replace("g", "") + "g");
  for (let m = all.exec(text); m; m = all.exec(text)) {
    if (!DENIED.test(clauseBefore(text, m.index))) return true;
    // Every start is tried: «без ХСН. ХСН IIА» names it after the denial.
    all.lastIndex = m.index + 1;
  }
  return false;
}

/** Does this record show the condition, by its code or by its words? */
function recordShows(record: PatientCondition, c: Condition): boolean {
  // A coded record is decided by its code alone. Its words are mostly the
  // ICD-10 name of that code, and those name what the patient does NOT have
  // as often as what he has: I11.9 «… без (застойной) сердечной
  // недостаточности», R03.0 «… при отсутствии диагноза гипертензии», I63.3
  // «Инфаркт мозга, вызванный тромбозом …» (a stroke, which the thrombosis
  // row leaves out on purpose), I25.2 «Перенесенный в прошлом инфаркт
  // миокарда» (not an acute one). The code already says which it is.
  const code = codeOf(record);
  if (code) return c.icd.some((p) => code.startsWith(p));
  // An uncoded record names the condition in words («Эпилепсия» typed at
  // the desk). The same table decides, with the stricter record wording,
  // and a denied mention («Гипертоническая болезнь II ст., без ХСН») does
  // not count.
  const words = c.recordPattern === undefined ? c.pattern : c.recordPattern;
  if (!record.label || !words) return false;
  const text = fold(record.label);
  return !c.exclude?.test(text) && namesAffirmed(text, words);
}

export type ContraindicationHit = {
  /** The catalog line as written. */
  line: string;
  condition: { key: string; labelRu: string };
  /** The record that shows the condition. */
  record: PatientCondition;
  severity: CdsSeverity;
  /** The line is conditional («неконтролируемая», «(осторожно)»). */
  qualified: boolean;
};

/**
 * Catalog contraindication lines of one drug that the patient's records
 * meet. One hit per condition: two lines naming epilepsy warn once.
 */
export function findContraindicationHits(
  lines: readonly string[],
  records: readonly PatientCondition[],
): ContraindicationHit[] {
  const out: ContraindicationHit[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const c of conditionsOfLine(line)) {
      if (seen.has(c.key)) continue;
      const record = records.find((r) => recordShows(r, c));
      if (!record) continue;
      seen.add(c.key);
      const qualified = isQualifiedLine(line);
      out.push({
        line,
        condition: { key: c.key, labelRu: c.labelRu },
        record,
        severity: qualified ? "MODERATE" : "MAJOR",
        qualified,
      });
    }
  }
  return out;
}

/** «G40.9, диагноз этого визита», «I63 Инфаркт мозга, в карте пациента». */
export function describeRecord(r: PatientCondition): string {
  const what = [r.code, r.label].filter(Boolean).join(" ");
  switch (r.origin) {
    case "VISIT":
      return `${what}, диагноз этого визита`;
    case "DIAGNOSIS":
      return `${what}, в карте пациента`;
    case "CHRONIC":
      return `${what}, хроническое заболевание в карте`;
  }
}

/** Codes the curated pairs' `riskDiagnoses` are compared against. */
export function patientCodes(records: readonly PatientCondition[]): string[] {
  return [
    ...new Set(records.flatMap((r) => (r.code ? [normCode(r.code)] : []))),
  ];
}
