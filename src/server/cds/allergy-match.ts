/**
 * Allergy ↔ drug matching for the CDS engine (audit G4-02).
 *
 * The first version compared raw substrings in both directions, which failed
 * both ways a doctor cares about:
 *   - «пенициллин» or «Амоксициллин» never reached Амоксиклав (its RU name,
 *     Latin INN and brands share no substring with either word), so a
 *     penicillin-allergic patient got a green «Конфликтов не найдено»;
 *   - a food allergy «мед» sat inside Сумамед, Мускомед, Итомед… and fired
 *     red «Не назначать» on unrelated drugs, training doctors to click past.
 *
 * Matching now works on whole words (with a little tolerance for Russian
 * case endings) and on drug classes:
 *
 *   1. Substance: a drug name (RU name, INN, each component of a combination,
 *      a brand of 5+ letters) appears as whole words in the allergy entry, or
 *      the allergy entry itself names the drug. «Амоксициллин (крапивница)»
 *      matches amoxicillin; «мед» matches nothing.
 *   2. Class: the entry names a class («пенициллин», «НПВС», «сульфаниламиды»)
 *      or a member of a class whose members cross-react, and the drug belongs
 *      to that class by ATC code, catalog id or active substance name. That is
 *      how «Амоксициллин» reaches Амоксиклав and ампициллин, and «аспирин»
 *      reaches ибупрофен.
 *
 * The class table is deliberately limited to groups with established
 * cross-reactivity that allergy guidelines tell prescribers to respect.
 * Cross-reactivity between classes (penicillins → cephalosporins) and
 * non-antibiotic sulfonamides are left out on purpose: the evidence does not
 * support a blanket block and false alarms cost more trust than they buy.
 */

export type AllergyDrug = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  brandNames?: string[];
};

export type AllergyClass = {
  key: string;
  /** Russian group label used in the warning text. */
  labelRu: string;
  /** Words naming the class itself in an allergy entry (RU / Latin / UZ). */
  classTerms: string[];
  /** Active substances and common brands of the class, as patients write them. */
  memberTerms: string[];
  /** ATC prefixes of the class (WHO ATC index). */
  atc: string[];
  /** ATC codes under those prefixes that are NOT in the class. */
  excludeAtc?: string[];
  /** Catalog ids that carry no ATC code in the static catalog. */
  ids: string[];
};

export type AllergyMatch =
  | { kind: "SUBSTANCE" }
  | {
      kind: "CLASS";
      cls: AllergyClass;
      /** true when the entry named the class itself, false for a member. */
      namedClass: boolean;
    };

/**
 * Cross-reactive groups. Sources: EAACI / AAAAI drug allergy practice
 * parameters (penicillins, cephalosporins, NSAID cross-intolerance incl.
 * aspirin), SmPC of oxcarbazepine sect. 4.4 (25–30% cross-hypersensitivity
 * with carbamazepine); the rest are same-class groups by WHO ATC.
 */
export const ALLERGY_CLASSES: AllergyClass[] = [
  {
    key: "PENICILLINS",
    labelRu: "пенициллины",
    classTerms: [
      "пенициллин", "пенициллины", "penicillin", "penitsillin", "penisillin",
      "бета лактам", "бета лактамы", "бета лактамные", "beta lactam",
    ],
    memberTerms: [
      "амоксициллин", "amoxicillin", "amoksitsillin", "ампициллин",
      "ampicillin", "ampitsillin", "сультамициллин", "sultamicillin",
      "оксациллин", "oxacillin", "бензилпенициллин", "benzylpenicillin",
      "феноксиметилпенициллин", "бициллин", "пиперациллин", "piperacillin",
      "амоксиклав", "аугментин", "флемоксин", "флемоклав", "ампиокс",
      "уназин",
    ],
    atc: ["J01C"],
    ids: ["amoxicillin", "amoxiclav", "ampicillin", "sultamicillin"],
  },
  {
    key: "CEPHALOSPORINS",
    labelRu: "цефалоспорины",
    classTerms: [
      "цефалоспорин", "цефалоспорины", "cephalosporin", "sefalosporin",
      "бета лактам", "бета лактамы", "бета лактамные", "beta lactam",
    ],
    memberTerms: [
      "цефтриаксон", "ceftriaxone", "seftriakson", "цефиксим", "cefixime",
      "цефуроксим", "cefuroxime", "цефалексин", "cefalexin", "cephalexin",
      "цефазолин", "cefazolin", "цефтазидим", "ceftazidime", "цефепим",
      "cefepime", "цефоперазон", "cefoperazone", "цефотаксим", "cefotaxime",
      "супракс", "зиннат",
    ],
    atc: ["J01DB", "J01DC", "J01DD", "J01DE", "J01DI"],
    ids: [
      "ceftriaxone", "cefixime", "cefuroxime", "cephalexin", "ceftazidime",
      "cefepime",
    ],
  },
  {
    key: "CARBAPENEMS",
    labelRu: "карбапенемы",
    classTerms: ["карбапенем", "карбапенемы", "carbapenem"],
    memberTerms: ["меропенем", "meropenem", "имипенем", "imipenem", "эртапенем", "ertapenem"],
    atc: ["J01DH"],
    ids: ["meropenem"],
  },
  {
    key: "MACROLIDES",
    labelRu: "макролиды",
    classTerms: ["макролид", "макролиды", "macrolide", "makrolid"],
    memberTerms: [
      "азитромицин", "azithromycin", "azitromitsin", "кларитромицин",
      "clarithromycin", "эритромицин", "erythromycin", "джозамицин",
      "josamycin", "сумамед", "клацид", "вильпрафен",
    ],
    atc: ["J01FA"],
    ids: ["azithromycin", "clarithromycin", "josamycin"],
  },
  {
    key: "FLUOROQUINOLONES",
    labelRu: "фторхинолоны",
    classTerms: [
      "фторхинолон", "фторхинолоны", "хинолон", "хинолоны",
      "fluoroquinolone", "ftorxinolon",
    ],
    memberTerms: [
      "ципрофлоксацин", "ciprofloxacin", "левофлоксацин", "levofloxacin",
      "моксифлоксацин", "moxifloxacin", "офлоксацин", "ofloxacin",
      "норфлоксацин", "norfloxacin", "ципролет", "таваник", "авелокс",
    ],
    atc: ["J01MA"],
    ids: ["ciprofloxacin", "levofloxacin", "moxifloxacin"],
  },
  {
    key: "TETRACYCLINES",
    labelRu: "тетрациклины",
    classTerms: ["тетрациклин", "тетрациклины", "tetracycline"],
    memberTerms: ["доксициклин", "doxycycline", "миноциклин", "minocycline", "юнидокс"],
    atc: ["J01AA"],
    ids: ["doxycycline"],
  },
  {
    key: "AMINOGLYCOSIDES",
    labelRu: "аминогликозиды",
    classTerms: ["аминогликозид", "аминогликозиды", "aminoglycoside"],
    memberTerms: [
      "гентамицин", "gentamicin", "амикацин", "amikacin", "тобрамицин",
      "tobramycin", "стрептомицин", "streptomycin", "тобрекс",
    ],
    atc: ["J01GB", "S01AA12"],
    ids: ["gentamicin", "tobrex"],
  },
  {
    key: "SULFONAMIDES",
    labelRu: "сульфаниламиды",
    classTerms: [
      "сульфаниламид", "сульфаниламиды", "сульфаниламидные", "сульфа",
      "sulfonamide", "sulfa", "sulfanilamid",
    ],
    memberTerms: [
      "ко тримоксазол", "котримоксазол", "co trimoxazole", "сульфаметоксазол",
      "sulfamethoxazole", "бисептол", "бактрим", "сульфацетамид",
      "сульфацил", "альбуцид",
    ],
    atc: ["J01E", "S01AB"],
    ids: ["co_trimoxazole", "sulfacyl"],
  },
  {
    key: "NSAIDS",
    labelRu: "НПВС и аспирин",
    classTerms: [
      "нпвс", "нпвп", "нестероидные противовоспалительные",
      "нестероидный противовоспалительный", "nsaid", "nsaids",
    ],
    memberTerms: [
      "аспирин", "aspirin", "ацетилсалициловая кислота",
      "acetylsalicylic acid", "ибупрофен", "ibuprofen", "диклофенак",
      "diclofenac", "кеторолак", "ketorolac", "нимесулид", "nimesulide",
      "мелоксикам", "meloxicam", "напроксен", "naproxen", "кетопрофен",
      "ketoprofen", "декскетопрофен", "dexketoprofen", "лорноксикам",
      "lornoxicam", "ацеклофенак", "aceclofenac", "пироксикам", "piroxicam",
      "индометацин", "indometacin", "эторикоксиб", "etoricoxib",
      "целекоксиб", "celecoxib", "этодолак", "etodolac", "нурофен",
      "вольтарен", "ортофен", "кетанов", "кеторол", "найз", "мовалис",
      "кетонал", "кардиомагнил",
    ],
    atc: ["M01A", "N02BA", "B01AC06", "B01AC56"],
    // Glucosamine, diacerein, chondroitin, ASU sit under M01AX but are not
    // NSAIDs (WHO ATC index).
    excludeAtc: ["M01AX05", "M01AX21", "M01AX25", "M01AX26"],
    ids: [
      "dexketoprofen", "lornoxicam", "etoricoxib", "aceclofenac", "piroxicam",
      "aspirin_cardio",
    ],
  },
  {
    key: "LOCAL_ANESTHETICS",
    labelRu: "местные анестетики",
    classTerms: [
      "местные анестетики", "местный анестетик", "местной анестезии",
      "local anesthetic", "local anaesthetic",
    ],
    memberTerms: [
      "лидокаин", "lidocaine", "lidokain", "новокаин", "novokain", "прокаин",
      "procaine", "артикаин", "articaine", "ультракаин", "бупивакаин",
      "bupivacaine", "ропивакаин", "ropivacaine", "мепивакаин", "бензокаин",
      "анестезин",
    ],
    atc: ["N01B"],
    ids: [],
  },
  {
    key: "IODINE_CONTRAST",
    labelRu: "йод и йодсодержащие контрастные средства",
    classTerms: [
      "йод", "йоду", "yod", "iodine", "йодсодержащие", "йодсодержащий",
      "контраст", "контрастное вещество", "контрастные вещества",
      "рентгенконтрастные",
    ],
    memberTerms: [
      "повидон йод", "бетадин", "йодопирон", "йогексол", "омнипак",
      "йопромид", "ультравист", "йодиксанол", "визипак", "калия йодид",
      "йодомарин",
    ],
    atc: ["V08A", "D08AG", "H03CA"],
    ids: [],
  },
  {
    key: "CARBAMAZEPINE_GROUP",
    labelRu: "карбамазепин и окскарбазепин",
    classTerms: [],
    memberTerms: [
      "карбамазепин", "carbamazepine", "karbamazepin", "финлепсин",
      "тегретол", "окскарбазепин", "oxcarbazepine", "трилептал",
      "эсликарбазепин", "eslicarbazepine",
    ],
    atc: ["N03AF"],
    ids: ["carbamazepine", "oxcarbazepine"],
  },
];

/**
 * Words that never identify a substance on their own: salt names, dosage
 * forms, filler words of an allergy entry. A phrase made only of these (or
 * of words shorter than five letters) is not allowed to match loosely.
 */
const STOPWORDS = new Set([
  "кислота", "кислоты", "кислоте", "натрия", "калия", "магния", "кальция",
  "гидрохлорид", "сульфат", "форте", "ретард", "кардио", "таблетки",
  "таблетка", "капсулы", "раствор", "мазь", "гель", "сироп", "капли",
  "экстракт", "витамин", "витамины", "препарат", "препараты", "лекарства",
  "лекарство", "аллергия", "аллергии", "реакция", "непереносимость",
  "acid", "sodium", "potassium", "forte", "retard", "sulfate", "sulphate",
  "hydrochloride",
]);

/** Lowercase, fold ё→е, drop apostrophes (o‘g‘li → ogli), keep letters/digits. */
export function allergyTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/['’‘ʻʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** A case ending is at most two letters: «цефтриаксон» / «цефтриаксону». */
const MAX_ENDING = 2;

/**
 * Two words name the same thing: equal, or the same word with a different
 * case ending. Only the ending may differ, never the body of the word.
 *
 * The first version allowed any word to start with the other's stem, and a
 * 6 or 7 letter word stems to five letters. That let «Сумамед» reach
 * Сумамигрен (sumatriptan), «Кларитромицин» reach Кларитин (loratadine),
 * «Супракс» reach Супрастин and «Кардиомагнил» reach Кардил (diltiazem):
 * red «Не назначать» on core drugs, the very alarm fatigue this module was
 * written to remove. Now the lengths may differ by an ending at most, so a
 * short word can never swallow a longer, different name.
 *
 * Salt and form words («сульфат») match only themselves: «сульфа» (the
 * sulfonamide class) plus one letter is iron sulfate, not a sulfonamide.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (STOPWORDS.has(a) !== STOPWORDS.has(b)) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > MAX_ENDING) return false;
  let common = 0;
  while (common < short.length && short[common] === long[common]) common += 1;
  // «пенициллин» → «пенициллины»: the shorter word is the whole stem. Short
  // words must be equal, which is what keeps «мед» away from «медь».
  if (common === short.length) return common >= 5;
  // «цефтриаксона» ↔ «цефтриаксону»: both carry an ending on a shared stem.
  // Six letters of stem, so «кардио» and «кардил» stay different words.
  return (
    common >= 6 &&
    short.length - common <= MAX_ENDING &&
    long.length - common <= MAX_ENDING
  );
}

function isSignificant(tokens: string[]): boolean {
  return tokens.some((t) => t.length >= 5 && !STOPWORDS.has(t));
}

/** `needle` occurs as consecutive whole words inside `haystack`. */
function containsPhrase(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let all = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (!tokensMatch(haystack[i + j], needle[j])) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/** Split «Amoxicillin + Clavulanate» / «Леводопа/карбидопа» into parts. */
function components(name: string): string[] {
  return name
    .split(/\s*(?:\+|\/|,|\s и\s|\sand\s)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A name a drug is known by. `exactOnly` marks a short multi-word brand
 * («Но-шпа»: two words under five letters) — too short to match inside
 * other text, but an allergy recorded as exactly that name must warn.
 */
type DrugPhrase = { toks: string[]; exactOnly: boolean };

/** Every name a drug is known by, as token phrases. */
function drugPhrases(drug: AllergyDrug): DrugPhrase[] {
  const out: DrugPhrase[] = [];
  const push = (s: string, minLen: number) => {
    const toks = allergyTokens(s);
    if (toks.length === 0) return;
    if (toks.join("").length < minLen) return;
    if (!isSignificant(toks)) {
      if (toks.length > 1 && toks.join("").length >= 5) {
        out.push({ toks, exactOnly: true });
      }
      return;
    }
    out.push({ toks, exactOnly: false });
  };
  // Catalog ids like «clinic:…» or «uzr-…» are not names; the INN column
  // mirrors the id for a few seeded rows, so skip anything slug-shaped.
  const innLooksLikeSlug = /[_:]/.test(drug.inn);
  for (const s of [drug.nameRu, ...(innLooksLikeSlug ? [] : [drug.inn])]) {
    push(s, 4);
    for (const c of components(s)) push(c, 4);
  }
  // Brands of three or four letters («МИГ», «Наком») collide with ordinary
  // words; the audit asked not to match allergy entries against them.
  for (const b of drug.brandNames ?? []) push(b, 5);
  return out;
}

function drugInClass(drug: AllergyDrug, cls: AllergyClass, phrases: DrugPhrase[]): boolean {
  if (cls.ids.includes(drug.id)) return true;
  const atc = drug.atcCode?.toUpperCase();
  if (atc && cls.excludeAtc?.some((p) => atc.startsWith(p))) return false;
  if (atc && cls.atc.some((p) => atc.startsWith(p))) return true;
  // Registry rows often lack an ATC code: fall back to the substance name.
  return cls.memberTerms.some((m) => {
    const needle = allergyTokens(m);
    return phrases.some((p) => !p.exactOnly && containsPhrase(p.toks, needle));
  });
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/** Does the allergy entry name the class, or one of its members? */
function allergyHitsClass(
  tokens: string[],
  cls: AllergyClass,
): { hit: boolean; namedClass: boolean } {
  for (const term of cls.classTerms) {
    if (containsPhrase(tokens, allergyTokens(term))) {
      return { hit: true, namedClass: true };
    }
  }
  for (const term of cls.memberTerms) {
    if (containsPhrase(tokens, allergyTokens(term))) {
      return { hit: true, namedClass: false };
    }
  }
  return { hit: false, namedClass: false };
}

/**
 * Match one recorded allergy against one drug. Returns the strongest reason
 * (same substance beats same class) or `null`.
 */
export function matchAllergy(
  substance: string,
  drug: AllergyDrug,
): AllergyMatch | null {
  const tokens = allergyTokens(substance);
  if (tokens.length === 0) return null;
  // The reaction is often written in brackets: «Амоксициллин (крапивница)».
  const core = allergyTokens(substance.replace(/\([^)]*\)/g, " "));

  const phrases = drugPhrases(drug);

  // 1. Substance: a drug name appears in the entry…
  if (
    phrases.some((p) =>
      p.exactOnly ? sameTokens(core, p.toks) : containsPhrase(tokens, p.toks),
    )
  ) {
    return { kind: "SUBSTANCE" };
  }
  // …or the entry itself names the drug («ацетилсалициловая кислота» in
  // «Ацетилсалициловая кислота кардио»). Only for a meaningful entry, so a
  // three-letter food allergy never matches by being short.
  if (
    isSignificant(core) &&
    phrases.some((p) => !p.exactOnly && containsPhrase(p.toks, core))
  ) {
    return { kind: "SUBSTANCE" };
  }

  // 2. Class.
  for (const cls of ALLERGY_CLASSES) {
    const { hit, namedClass } = allergyHitsClass(tokens, cls);
    if (!hit) continue;
    if (drugInClass(drug, cls, phrases)) {
      return { kind: "CLASS", cls, namedClass };
    }
  }
  return null;
}
