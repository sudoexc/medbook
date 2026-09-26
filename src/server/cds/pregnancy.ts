/**
 * Pregnancy check for the CDS engine (audit G4-13).
 *
 * The first version warned only when the catalog row said D or X AND the
 * card said FEMALE with a known age, so it stayed silent twice over:
 *   - the live queue and the Mini App never ask for sex, so almost every
 *     walk-in card has `gender = null` and no drug was ever checked;
 *   - only the curated rows carry a category. Simvastatin, perindopril,
 *     telmisartan, phenytoin, paroxetine, clonazepam from the extension and
 *     every register product (methotrexate, isotretinoin, misoprostol…) are
 *     UNKNOWN, while atorvastatin next to them is X. The card showed a green
 *     «Конфликтов не найдено» either way.
 *
 * Now:
 *   1. A drug the catalog left UNKNOWN takes its category from a short table
 *      of well documented teratogenic classes, keyed on ATC and catalog ids
 *      like the interaction rules. A category the catalog does set always
 *      wins: the table fills gaps, it never overrides a curated value.
 *   2. The patient may be pregnant unless the card (or, when the card is
 *      blank, the name) says male, or the age is known and outside 12–55.
 *      With the sex unknown the warning is worded conditionally and one step
 *      softer, so a man is not told his statin is «противопоказан».
 *   3. Drugs whose category is still unknown are reported back, so the card
 *      says the check was not done instead of an all-clear.
 *
 * User-visible text is Russian, like the rest of the engine's warnings (it
 * is also stored verbatim in CdsOverride snapshots).
 */
import type { Gender } from "@/generated/prisma/client";

import type { CdsSeverity, CdsWarning, ResolvedDrug } from "./drug-check";
import { drugInClass, type DrugClass } from "./interaction-rules";

export type PregnancyCat = ResolvedDrug["pregnancyCat"];

type RiskClass = {
  level: "D" | "X";
  cls: DrugClass;
  /** Where the risk is documented. Not shown in the UI. */
  source: string;
};

/**
 * Teratogenic classes by WHO ATC code, plus catalog ids for extension rows
 * that carry no ATC. The D rows that mirror a curated category (doxycycline,
 * gentamicin, fluconazole…) are there so a register product of the same
 * substance gets the same answer as the curated row.
 *
 * Deliberately narrow: label level contraindications and FDA D/X classes
 * only. Needs a pharmacist's review before it grows.
 */
export const PREGNANCY_RISK_CLASSES: RiskClass[] = [
  // ── Contraindicated in pregnancy ──────────────────────────────────────
  {
    level: "X",
    cls: {
      atc: ["C10AA", "C10BA", "C10BX"],
      ids: ["simvastatin", "atorvastatin", "rosuvastatin"],
    },
    source: "Statin SmPC 4.3 / 4.6 (contraindicated during pregnancy)",
  },
  {
    level: "X",
    cls: { atc: ["B01AA"], ids: ["warfarin"] },
    source: "Warfarin SmPC 4.3 (coumarin embryopathy)",
  },
  {
    level: "X",
    cls: { atc: ["N03AG01", "N03AG02"], ids: ["valproate"] },
    source: "Valproate SmPC 4.3 / 4.6; EMA PRAC 2018 pregnancy prevention programme",
  },
  {
    level: "X",
    cls: { atc: ["L01BA01", "L04AX03"], ids: [] },
    source: "Methotrexate SmPC 4.3",
  },
  {
    level: "X",
    cls: { atc: ["D10BA01", "D10AD04", "D05BB02"], ids: [] },
    source: "Isotretinoin (oral and topical) / acitretin SmPC 4.3, pregnancy prevention programme",
  },
  {
    level: "X",
    cls: { atc: ["A02BB01", "G02AD06"], ids: [] },
    source: "Misoprostol SmPC 4.3",
  },
  {
    level: "X",
    cls: { atc: ["L04AA13", "L04AA31", "L04AA06"], ids: [] },
    source: "Leflunomide / teriflunomide / mycophenolate SmPC 4.3",
  },
  {
    level: "X",
    cls: { atc: ["L04AX02", "L04AX04", "L04AX06"], ids: [] },
    source: "Thalidomide / lenalidomide / pomalidomide SmPC 4.3",
  },
  {
    level: "X",
    cls: { atc: ["N02CA"], ids: [] },
    source: "Ergotamine / dihydroergotamine SmPC 4.3 (oxytocic)",
  },
  {
    level: "X",
    cls: { atc: ["G04CB"], ids: [] },
    source: "Finasteride / dutasteride SmPC 4.3 (contraindicated in women)",
  },
  {
    level: "X",
    cls: { atc: ["J05AP01"], ids: [] },
    source: "Ribavirin SmPC 4.3",
  },

  // ── Evidence of fetal risk: only when clearly needed ──────────────────
  {
    level: "D",
    cls: {
      atc: ["C09A", "C09B", "C09C", "C09D", "C09XA"],
      ids: [
        "enalapril", "lisinopril", "captopril", "ramipril", "perindopril",
        "losartan", "valsartan", "telmisartan", "irbesartan",
      ],
    },
    source: "ACE inhibitor / ARB / aliskiren SmPC 4.3 / 4.6 (2nd and 3rd trimester contraindicated)",
  },
  {
    level: "D",
    cls: { atc: ["N03AB"], ids: ["phenytoin"] },
    source: "Phenytoin SmPC 4.6 (fetal hydantoin syndrome); FDA category D",
  },
  {
    level: "D",
    cls: { atc: ["N03AF01"], ids: ["carbamazepine"] },
    source: "Carbamazepine SmPC 4.6 (neural tube defects); FDA category D",
  },
  {
    level: "D",
    cls: { atc: ["N03AA"], ids: ["phenobarbital"] },
    source: "Phenobarbital SmPC 4.6; FDA category D",
  },
  {
    level: "D",
    cls: { atc: ["N03AX11"], ids: ["topiramate"] },
    source: "Topiramate SmPC 4.6; EMA PRAC 2023 pregnancy prevention programme",
  },
  {
    // Tofisopam (Грандаксин) is rated C in the curated catalog: kept out so
    // its register twins agree with it.
    level: "D",
    cls: {
      atc: ["N05BA", "N05CD", "N03AE01"],
      ids: ["diazepam", "phenazepam", "clonazepam"],
      excludeIds: ["tofisopam"],
      excludeAtc: ["N05BA23"],
    },
    source: "Benzodiazepine labels, FDA category D",
  },
  {
    level: "D",
    cls: { atc: ["N06AB05"], ids: ["paroxetine"] },
    source: "Paroxetine SmPC 4.6 (cardiac malformations); FDA 2005",
  },
  {
    level: "D",
    cls: { atc: ["N05AN01"], ids: [] },
    source: "Lithium SmPC 4.6 (Ebstein anomaly)",
  },
  {
    level: "D",
    cls: { atc: ["J01AA"], ids: ["doxycycline"] },
    source: "Tetracycline SmPC 4.6 (teeth and bone); FDA category D",
  },
  {
    level: "D",
    cls: { atc: ["J01GA", "J01GB"], ids: ["gentamicin"] },
    source: "Aminoglycoside SmPC 4.6 (fetal ototoxicity); FDA category D",
  },
  {
    level: "D",
    cls: { atc: ["C01BD01"], ids: ["amiodarone"] },
    source: "Amiodarone SmPC 4.6 (fetal thyroid); FDA category D",
  },
  {
    level: "D",
    cls: { atc: ["H03BB"], ids: ["thiamazole"] },
    source: "Thiamazole SmPC 4.6 (embryopathy)",
  },
  {
    level: "D",
    cls: { atc: ["J02AC01"], ids: ["fluconazole"] },
    source: "Fluconazole SmPC 4.6 (high dose, 1st trimester); FDA DSC 2011",
  },
  {
    level: "D",
    cls: { atc: ["J01EE01"], ids: ["co_trimoxazole"] },
    source: "Co-trimoxazole SmPC 4.6 (folate antagonist)",
  },
  {
    level: "D",
    cls: { atc: ["N02BA01"], ids: ["aspirin"] },
    source: "Acetylsalicylic acid (analgesic dose) SmPC 4.6 (3rd trimester)",
  },
];

/**
 * The category the check works with: the catalog's own value when it has
 * one, else the strictest class the drug belongs to, else UNKNOWN.
 */
export function effectivePregnancyCat(
  drug: Pick<ResolvedDrug, "id" | "atcCode" | "pregnancyCat">,
): PregnancyCat {
  if (drug.pregnancyCat !== "UNKNOWN") return drug.pregnancyCat;
  for (const level of ["X", "D"] as const) {
    if (
      PREGNANCY_RISK_CLASSES.some(
        (r) => r.level === level && drugInClass(drug, r.cls),
      )
    ) {
      return level;
    }
  }
  return "UNKNOWN";
}

function nameTokens(fullName: string): string[] {
  return fullName
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/['’‘ʻʼ`]/g, "")
    .split(/[^\p{L}]+/u)
    .filter((t) => t.length >= 4);
}

// Patronymics: unambiguous whenever present («Рустамовна», «Rustam qizi»).
// A male «-вич» also ends surnames of both sexes («Ходкевич»), so it counts
// only in the patronymic's place: the last of three or more words.
const FEMALE_PATRONYMIC = /(овна|евна|ична|ovna|evna|ichna)$/;
const MALE_PATRONYMIC = /(ович|евич|ьич|ovich|evich)$/;
const FEMALE_PATRONYMIC_WORDS = new Set(["қизи", "кизи", "кызы", "qizi", "kizi"]);
const MALE_PATRONYMIC_WORDS = new Set([
  "ўғли", "угли", "уғли", "огли", "оглы", "ogli", "ugli", "ogly",
]);
// Surnames: the doctor types «Турматов О 1969», so the surname is often the
// only signal. «-ин/-ина» is left out on purpose: female first names such as
// Ясмин end the same way.
const FEMALE_SURNAME = /(ова|ева|ская|цкая|ova|eva|skaya)$/;
const MALE_SURNAME = /(ов|ев|ский|цкий|ov|ev|skiy|sky)$/;

/**
 * Sex as written in a Russian or Uzbek full name, or null when the name does
 * not say or says both. Used only when the card itself is blank: a stated
 * sex always wins. Patronymics decide before surnames.
 */
export function sexFromName(fullName: string | null | undefined): Gender | null {
  if (!fullName) return null;
  const tokens = nameTokens(fullName);
  // One side matched: that sex. Both: the name contradicts itself, so the
  // answer is unknown (null) and weaker signals are not consulted. Neither:
  // undefined, try the next signal.
  const decide = (female: boolean, male: boolean): Gender | null | undefined => {
    if (female && male) return null;
    if (female) return "FEMALE";
    if (male) return "MALE";
    return undefined;
  };

  const last = tokens.length >= 3 ? tokens[tokens.length - 1]! : "";
  const byPatronymic = decide(
    tokens.some((t) => FEMALE_PATRONYMIC.test(t) || FEMALE_PATRONYMIC_WORDS.has(t)),
    MALE_PATRONYMIC.test(last) || tokens.some((t) => MALE_PATRONYMIC_WORDS.has(t)),
  );
  if (byPatronymic !== undefined) return byPatronymic;
  return (
    decide(
      tokens.some((t) => FEMALE_SURNAME.test(t)),
      tokens.some((t) => MALE_SURNAME.test(t)),
    ) ?? null
  );
}

function ageAt(birthDate: Date | null, now: Date): number | null {
  if (!birthDate) return null;
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = now.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthDate.getUTCDate())) age -= 1;
  return age;
}

/**
 * Could this patient be pregnant, as far as the card knows?
 *   - NONE: male (stated, or by name on a blank card), or an age known to be
 *     outside 12–55;
 *   - FEMALE: stated or named female, age fertile or unknown;
 *   - UNKNOWN_SEX: nothing says either way.
 */
export type PregnancyContext = "NONE" | "FEMALE" | "UNKNOWN_SEX";

export function pregnancyContext(
  patient: {
    gender: Gender | null;
    birthDate: Date | null;
    fullName?: string | null;
  } | null,
  now: Date = new Date(),
): PregnancyContext {
  const age = ageAt(patient?.birthDate ?? null, now);
  if (age !== null && (age < 12 || age > 55)) return "NONE";
  const sex = patient?.gender ?? sexFromName(patient?.fullName);
  if (sex === "MALE") return "NONE";
  return sex === "FEMALE" ? "FEMALE" : "UNKNOWN_SEX";
}

/** One warning per drug of category D or X, or null. */
export function pregnancyWarning(
  drug: Pick<ResolvedDrug, "id" | "nameRu" | "inn" | "atcCode" | "pregnancyCat">,
  context: PregnancyContext,
): CdsWarning | null {
  if (context === "NONE") return null;
  const cat = effectivePregnancyCat(drug);
  if (cat !== "D" && cat !== "X") return null;
  const drugA = { id: drug.id, nameRu: drug.nameRu, inn: drug.inn };

  if (context === "FEMALE") {
    return {
      kind: "PREGNANCY",
      severity: cat === "X" ? "CONTRAINDICATED" : "MAJOR",
      title: `Категория беременности ${cat}: ${drug.nameRu}`,
      detail:
        cat === "X"
          ? "Противопоказан при беременности. Уточнить статус и исключить беременность."
          : "Применять только при крайней необходимости у женщин фертильного возраста. Исключить беременность.",
      drugA,
    };
  }

  // Sex unknown: the risk is real only if the patient is a woman, so the
  // text says «если» and the severity drops one step (still red for X).
  const severity: CdsSeverity = cat === "X" ? "MAJOR" : "MODERATE";
  return {
    kind: "PREGNANCY",
    severity,
    title: `Если пациентка беременна: ${drug.nameRu}, категория ${cat}`,
    detail:
      cat === "X"
        ? "Пол в карточке не указан. Если пациентка беременна или планирует беременность, препарат противопоказан: уточните статус до назначения."
        : "Пол в карточке не указан. Если пациентка беременна или планирует беременность, применять только при крайней необходимости: уточните статус.",
    drugA,
  };
}
