/**
 * Class-level drug interaction rules for the CDS engine (audit G4-01).
 *
 * The curated `DrugInteraction` table holds pairs of catalog ids and was
 * written for general practice: not one of its pairs touched the 78
 * neurological and psychiatric drugs this clinic prescribes daily, so
 * «Трамадол + Амитриптилин» or «Депакин + Ламотриджин» came back as a green
 * «Конфликтов не найдено». Rules here are keyed on drug classes instead:
 * a class is a set of WHO ATC prefixes plus catalog ids for rows that carry
 * no ATC code (the static catalog left some blank), so one rule also covers
 * every registry product with the same ATC code.
 *
 * Scope is deliberately narrow: only interactions that the product's own
 * SmPC / label or a regulator safety communication spells out, and that are
 * actionable for an outpatient neurologist. Each rule names its source in
 * `source`. Adding a rule means adding a documented interaction, never a
 * theoretical one; when in doubt, leave it out and the card says «нет
 * данных о взаимодействиях» honestly instead.
 *
 * User-visible `mechanism` / `advice` are Russian, like the curated table.
 */
import type { CdsSeverity } from "./drug-check";

export type DrugClass = {
  /** WHO ATC prefixes (any level: "N06AB" = SSRIs, "N02AX02" = tramadol). */
  atc: string[];
  /** Catalog ids with no ATC code, or ids worth pinning explicitly. */
  ids: string[];
  /** Ids to keep out even when their ATC prefix matches. */
  excludeIds?: string[];
  /** ATC codes to keep out even when a broader prefix matches. */
  excludeAtc?: string[];
};

export type InteractionRule = {
  key: string;
  a: DrugClass;
  b: DrugClass;
  severity: CdsSeverity;
  mechanism: string;
  advice: string;
  /** Where the interaction is documented. Not shown in the UI. */
  source: string;
};

export type RuleDrug = { id: string; atcCode: string | null };

function union(...classes: DrugClass[]): DrugClass {
  return {
    atc: classes.flatMap((c) => c.atc),
    ids: classes.flatMap((c) => c.ids),
    excludeIds: classes.flatMap((c) => c.excludeIds ?? []),
    excludeAtc: classes.flatMap((c) => c.excludeAtc ?? []),
  };
}

export function drugInClass(drug: RuleDrug, cls: DrugClass): boolean {
  if (cls.excludeIds?.includes(drug.id)) return false;
  const atc = drug.atcCode?.trim().toUpperCase() ?? "";
  if (atc && cls.excludeAtc?.some((p) => atc.startsWith(p))) return false;
  if (cls.ids.includes(drug.id)) return true;
  return !!atc && cls.atc.some((p) => atc.startsWith(p));
}

// ── Drug classes ─────────────────────────────────────────────────────────
// Catalog ids come from prisma/_drug-catalog*.ts and the clinic formulary
// (scripts/data/formulary-neurofax.ts); ATC codes from the WHO ATC index.

const SSRI: DrugClass = {
  atc: ["N06AB"],
  ids: ["fluoxetine", "paroxetine", "fluvoxamine", "sertraline", "escitalopram"],
};
const SNRI: DrugClass = {
  atc: ["N06AX16", "N06AX21"],
  ids: ["venlafaxine", "duloxetine"],
};
const TCA: DrugClass = { atc: ["N06AA"], ids: ["amitriptyline"] };
const SEROTONERGIC_AD = union(SSRI, SNRI);
// N02AJ13 / N02AJ14: tramadol + paracetamol / + dexketoprofen combinations.
const TRAMADOL: DrugClass = {
  atc: ["N02AX02", "N02AJ13", "N02AJ14"],
  ids: ["tramadol"],
};
const OPIOIDS = union({ atc: ["N02A"], ids: [] }, TRAMADOL);
const TRIPTANS: DrugClass = {
  atc: ["N02CC"],
  ids: ["sumatriptan", "zolmitriptan", "rizatriptan", "eletriptan"],
};
// Tofisopam (Грандаксин, N05BA23) is a 2,3-benzodiazepine without the
// sedative / respiratory profile the warnings are about.
const BENZODIAZEPINES: DrugClass = {
  atc: ["N05BA", "N05CD", "N03AE"],
  ids: ["diazepam", "phenazepam", "clonazepam"],
  excludeIds: ["tofisopam"],
  excludeAtc: ["N05BA23"],
};
const Z_HYPNOTICS: DrugClass = { atc: ["N05CF"], ids: ["zopiclone", "zolpidem"] };
const GABAPENTINOIDS: DrugClass = {
  atc: ["N03AX12", "N03AX16"],
  ids: ["gabapentin", "pregabalin"],
};
const BARBITURATES: DrugClass = { atc: ["N03AA", "N05CA"], ids: ["phenobarbital"] };
const CNS_DEPRESSANTS = union(BENZODIAZEPINES, Z_HYPNOTICS, GABAPENTINOIDS, BARBITURATES);

const VALPROATE: DrugClass = { atc: ["N03AG01", "N03AG02"], ids: ["valproate"] };
const LAMOTRIGINE: DrugClass = { atc: ["N03AX09"], ids: ["lamotrigine"] };
const CARBAMAZEPINE: DrugClass = { atc: ["N03AF01"], ids: ["carbamazepine"] };
// Classic hepatic enzyme inducers: carbamazepine, phenytoin, phenobarbital.
const ENZYME_INDUCING_AED: DrugClass = {
  atc: ["N03AF01", "N03AB", "N03AA"],
  ids: ["carbamazepine", "phenytoin", "phenobarbital"],
};
const TOPIRAMATE: DrugClass = { atc: ["N03AX11"], ids: ["topiramate"] };
const CARBAPENEMS: DrugClass = { atc: ["J01DH"], ids: ["meropenem"] };
const CLARITHRO_ERYTHRO: DrugClass = { atc: ["J01FA09", "J01FA01"], ids: ["clarithromycin"] };

const TIZANIDINE: DrugClass = { atc: ["M03BX02"], ids: ["tizanidine", "tizanidine-mr"] };
const DULOXETINE: DrugClass = { atc: ["N06AX21"], ids: ["duloxetine"] };
const FLUVOXAMINE: DrugClass = { atc: ["N06AB08"], ids: ["fluvoxamine"] };
// Potent CYP1A2 inhibitors named in the tizanidine / duloxetine SmPC.
const CYP1A2_STRONG: DrugClass = {
  atc: ["J01MA02", "N06AB08"],
  ids: ["ciprofloxacin", "fluvoxamine"],
};
const MELATONIN: DrugClass = { atc: ["N05CH01"], ids: ["melatonin"] };

const PDE5_INHIBITORS: DrugClass = {
  atc: ["G04BE03", "G04BE08", "G04BE09", "G04BE10"],
  ids: ["sildenafil"],
};
const NITRATES: DrugClass = {
  atc: ["C01DA"],
  ids: ["nitroglycerin", "isosorbide-mononitrate"],
};

const ACEI_ARB: DrugClass = {
  atc: ["C09A", "C09B", "C09C", "C09D"],
  ids: [
    "enalapril", "lisinopril", "captopril", "ramipril", "perindopril",
    "losartan", "valsartan", "telmisartan", "irbesartan",
  ],
};
const POTASSIUM_SPARING: DrugClass = { atc: ["C03DA", "C03DB"], ids: ["spironolactone"] };
const POTASSIUM_SUPPLEMENTS: DrugClass = {
  atc: ["A12B"],
  ids: ["potassium_mg_asparaginate", "potassium-magnesium-asparaginate"],
};

const VKA: DrugClass = { atc: ["B01AA"], ids: ["warfarin"] };
const DOAC: DrugClass = {
  atc: ["B01AF", "B01AE07"],
  ids: ["rivaroxaban", "apixaban", "dabigatran"],
};
const ANTICOAGULANTS = union(VKA, DOAC);
const NSAIDS: DrugClass = {
  atc: ["M01A"],
  // M01AX also holds the slow-acting «хондропротекторы», which are not
  // NSAIDs and carry none of their bleeding risk: glucosamine (M01AX05),
  // diacerein (M01AX21), chondroitin (M01AX25), avocado/soy unsaponifiables
  // (M01AX26). WHO ATC index.
  excludeAtc: ["M01AX05", "M01AX21", "M01AX25", "M01AX26"],
  ids: ["dexketoprofen", "lornoxicam", "etoricoxib", "aceclofenac", "piroxicam"],
};
const ASPIRIN: DrugClass = {
  atc: ["N02BA01", "B01AC06", "B01AC56"],
  ids: ["aspirin", "aspirin_cardio"],
};
const P2Y12: DrugClass = { atc: ["B01AC04", "B01AC22", "B01AC24"], ids: ["clopidogrel"] };
const BLEEDING_RISK = union(NSAIDS, ASPIRIN, P2Y12);
const AMIODARONE: DrugClass = { atc: ["C01BD01"], ids: ["amiodarone"] };
const CYP2C9_INHIBITOR_ANTIINFECTIVES: DrugClass = {
  atc: ["J01XD01", "P01AB01", "J02AC01", "J01EE01"],
  ids: ["metronidazole", "fluconazole", "co_trimoxazole"],
};

const METOCLOPRAMIDE: DrugClass = { atc: ["A03FA01"], ids: ["metoclopramide"] };
const DOPAMINERGIC: DrugClass = {
  atc: ["N04BA", "N04BC"],
  ids: [
    "levodopa_carbidopa", "levodopa-carbidopa", "levodopa-benserazide",
    "pramipexole", "ropinirole",
  ],
};
// Haloperidol and tiapride: D2 blockers whose SmPC names levodopa.
const D2_BLOCKING_ANTIPSYCHOTICS: DrugClass = {
  atc: ["N05AD01", "N05AL03"],
  ids: ["haloperidol", "uzr-tiaprid"],
};
const LINEZOLID: DrugClass = { atc: ["J01XX08"], ids: ["linezolid"] };
const SIMVASTATIN: DrugClass = { atc: ["C10AA01"], ids: ["simvastatin"] };
const STRONG_CYP3A4_INHIBITORS: DrugClass = {
  atc: ["J01FA09", "J02AC02"],
  ids: ["clarithromycin", "itraconazole"],
};
const PROPRANOLOL: DrugClass = { atc: ["C07AA05"], ids: ["uzr-propranolol"] };
const RIZATRIPTAN: DrugClass = { atc: ["N02CC04"], ids: ["rizatriptan"] };
const CHOLINESTERASE_INHIBITORS: DrugClass = {
  atc: ["N06DA"],
  ids: ["galantamine", "donepezil", "rivastigmine", "ipidacrine"],
};
const ANTICHOLINERGIC_ANTIPARKINSON: DrugClass = { atc: ["N04AA"], ids: ["trihexyphenidyl"] };

// ── Rules ────────────────────────────────────────────────────────────────

export const INTERACTION_RULES: InteractionRule[] = [
  // Serotonergic combinations.
  {
    key: "tramadol+serotonergic-ad",
    a: TRAMADOL,
    b: union(SEROTONERGIC_AD, TCA),
    severity: "MAJOR",
    mechanism:
      "Риск серотонинового синдрома и снижение судорожного порога. Флуоксетин и пароксетин вдобавок ослабляют обезболивание трамадолом (CYP2D6)",
    advice:
      "Избегать сочетания. Если без него нельзя: минимальная доза трамадола и контроль симптомов серотонинового синдрома.",
    source: "Tramadol SmPC 4.4/4.5; FDA label Ultram (serotonin syndrome, seizure risk)",
  },
  {
    key: "tramadol+triptan",
    a: TRAMADOL,
    b: TRIPTANS,
    severity: "MODERATE",
    mechanism: "Оба препарата серотонинергические: риск серотонинового синдрома",
    advice:
      "Допустимо с осторожностью. Предупредить пациента о симптомах: возбуждение, тремор, потливость, лихорадка.",
    source: "FDA Drug Safety Communication 22.03.2016 (opioids and serotonin syndrome); tramadol SmPC 4.5",
  },
  {
    key: "triptan+ssri-snri",
    a: TRIPTANS,
    b: SEROTONERGIC_AD,
    severity: "MODERATE",
    mechanism: "Триптан на фоне СИОЗС или СИОЗСН: риск серотонинового синдрома",
    advice:
      "Сочетание допустимо. Не превышать дозу триптана, предупредить пациента о симптомах серотонинового синдрома.",
    source: "FDA Public Health Advisory 19.07.2006 (triptans with SSRIs/SNRIs); triptan SmPC 4.4",
  },
  {
    key: "ssri-snri+ssri-snri",
    a: SEROTONERGIC_AD,
    b: SEROTONERGIC_AD,
    severity: "MAJOR",
    mechanism: "Два серотонинергических антидепрессанта: риск серотонинового синдрома",
    advice: "Не комбинировать. При смене препарата соблюдать схему отмены.",
    source: "SSRI / SNRI SmPC 4.5 (other serotonergic medicinal products)",
  },
  {
    key: "ssri-snri+tca",
    a: SEROTONERGIC_AD,
    b: TCA,
    severity: "MODERATE",
    mechanism:
      "Риск серотонинового синдрома. Флуоксетин, пароксетин и дулоксетин повышают концентрацию трициклических антидепрессантов (CYP2D6)",
    advice: "По возможности избегать. Если нужно: снизить дозу ТЦА и следить за побочными эффектами.",
    source: "Fluoxetine / paroxetine / duloxetine SmPC 4.5 (TCA levels)",
  },
  {
    key: "linezolid+serotonergic",
    a: LINEZOLID,
    b: union(SEROTONERGIC_AD, TCA, TRAMADOL),
    severity: "MAJOR",
    mechanism: "Линезолид обратимо ингибирует МАО: риск серотонинового синдрома",
    advice: "Избегать сочетания. Если нельзя: наблюдение за симптомами серотонинового синдрома.",
    source: "Linezolid SmPC 4.4; FDA Drug Safety Communication 26.07.2011",
  },

  // CNS depression.
  {
    key: "opioid+sedative",
    a: OPIOIDS,
    b: union(BENZODIAZEPINES, Z_HYPNOTICS, BARBITURATES),
    severity: "MAJOR",
    mechanism: "Суммарное угнетение ЦНС и дыхания",
    advice:
      "Избегать сочетания. Если необходимо: минимальные дозы, короткий курс, предупредить о сонливости и запрете вождения.",
    source: "FDA boxed warning 31.08.2016 (opioids with benzodiazepines / CNS depressants)",
  },
  {
    key: "opioid+gabapentinoid",
    a: OPIOIDS,
    b: GABAPENTINOIDS,
    severity: "MAJOR",
    mechanism: "Габапентиноид вместе с опиоидом: риск угнетения дыхания",
    advice: "Начинать с минимальной дозы габапентина или прегабалина, контролировать седацию и дыхание.",
    source: "FDA Drug Safety Communication 19.12.2019 (gabapentinoids); pregabalin SmPC 4.4",
  },
  {
    key: "sedative+sedative",
    a: CNS_DEPRESSANTS,
    b: CNS_DEPRESSANTS,
    severity: "MODERATE",
    mechanism: "Суммарное седативное действие и угнетение ЦНС",
    advice: "Оценить необходимость сочетания. Предупредить о сонливости, риске падений и вождении.",
    source: "Benzodiazepine / Z-drug / gabapentinoid SmPC 4.5 (CNS depressants); FDA DSC 19.12.2019",
  },

  // Antiepileptics.
  {
    key: "valproate+lamotrigine",
    a: VALPROATE,
    b: LAMOTRIGINE,
    severity: "MAJOR",
    mechanism:
      "Вальпроат тормозит глюкуронирование ламотриджина и примерно вдвое повышает его концентрацию: растёт риск тяжёлой сыпи, включая синдром Стивенса-Джонсона",
    advice:
      "Начинать ламотриджин с половинной дозы и титровать по схеме для сочетания с вальпроатом. Контроль кожи в первые 8 недель.",
    source: "Lamotrigine SmPC 4.2, 4.4, 4.5",
  },
  {
    key: "inducer-aed+lamotrigine",
    a: ENZYME_INDUCING_AED,
    b: LAMOTRIGINE,
    severity: "MODERATE",
    mechanism: "Индукция глюкуронирования: концентрация ламотриджина снижается примерно вдвое",
    advice: "Титровать ламотриджин по схеме для индукторов. При отмене индуктора снизить дозу ламотриджина.",
    source: "Lamotrigine SmPC 4.2, 4.5",
  },
  {
    key: "inducer-aed+valproate",
    a: ENZYME_INDUCING_AED,
    b: VALPROATE,
    severity: "MODERATE",
    mechanism:
      "Индукторы снижают концентрацию вальпроата. Вальпроат повышает уровень фенобарбитала и активного эпоксида карбамазепина",
    advice: "Контроль концентраций и клинического эффекта обоих препаратов, особенно при смене доз.",
    source: "Valproate SmPC 4.5; carbamazepine SmPC 4.5",
  },
  {
    key: "valproate+topiramate",
    a: VALPROATE,
    b: TOPIRAMATE,
    severity: "MODERATE",
    mechanism: "Риск гипераммониемии и энцефалопатии",
    advice: "При вялости, рвоте или спутанности сознания проверить аммиак крови.",
    source: "Topiramate SmPC 4.4; valproate SmPC 4.4",
  },
  {
    key: "valproate+carbapenem",
    a: VALPROATE,
    b: CARBAPENEMS,
    severity: "MAJOR",
    mechanism: "Карбапенемы за 1-2 дня снижают концентрацию вальпроата на 60-100%: риск судорог",
    advice: "Сочетания избегать. Если без карбапенема нельзя: другое противосудорожное средство на время курса.",
    source: "Valproate SmPC 4.5 (carbapenems)",
  },
  {
    key: "carbamazepine+clarithromycin",
    a: CARBAMAZEPINE,
    b: CLARITHRO_ERYTHRO,
    severity: "MAJOR",
    mechanism:
      "Ингибирование CYP3A4: концентрация карбамазепина растёт до токсической (головокружение, атаксия, диплопия)",
    advice: "Выбрать другой антибиотик, например азитромицин, или контролировать уровень карбамазепина.",
    source: "Carbamazepine SmPC 4.5 (CYP3A4 inhibitors); clarithromycin SmPC 4.5",
  },
  {
    key: "carbamazepine+tramadol",
    a: CARBAMAZEPINE,
    b: TRAMADOL,
    severity: "MODERATE",
    mechanism:
      "Карбамазепин ускоряет метаболизм трамадола и ослабляет обезболивание. Трамадол снижает судорожный порог",
    advice: "Сочетания избегать, выбрать другой анальгетик.",
    source: "Tramadol SmPC 4.5 (carbamazepine)",
  },
  {
    key: "inducer-aed+warfarin",
    a: ENZYME_INDUCING_AED,
    b: VKA,
    severity: "MAJOR",
    mechanism: "Индукция печёночных ферментов: действие варфарина ослабевает",
    advice: "Контроль МНО при начале, смене дозы и отмене противоэпилептического препарата.",
    source: "Warfarin SmPC 4.5; carbamazepine SmPC 4.5",
  },

  // CYP1A2.
  {
    key: "tizanidine+cyp1a2",
    a: TIZANIDINE,
    b: CYP1A2_STRONG,
    severity: "CONTRAINDICATED",
    mechanism:
      "Ципрофлоксацин и флувоксамин блокируют CYP1A2: концентрация тизанидина растёт многократно, выраженная гипотензия и седация",
    advice: "Сочетание противопоказано. Выбрать другой антибиотик или другой миорелаксант.",
    source: "Tizanidine SmPC 4.3, 4.5",
  },
  {
    key: "duloxetine+cyp1a2",
    a: DULOXETINE,
    b: CYP1A2_STRONG,
    severity: "CONTRAINDICATED",
    mechanism: "Мощный ингибитор CYP1A2 многократно повышает концентрацию дулоксетина",
    advice: "Сочетание противопоказано.",
    source: "Duloxetine SmPC 4.3 (potent CYP1A2 inhibitors)",
  },
  {
    key: "melatonin+fluvoxamine",
    a: MELATONIN,
    b: FLUVOXAMINE,
    severity: "MODERATE",
    mechanism: "Флувоксамин блокирует CYP1A2 и многократно повышает концентрацию мелатонина",
    advice: "Сочетания избегать.",
    source: "Melatonin (Circadin) SmPC 4.5",
  },

  // Cardiovascular.
  {
    key: "pde5+nitrate",
    a: PDE5_INHIBITORS,
    b: NITRATES,
    severity: "CONTRAINDICATED",
    mechanism: "Резкое и опасное падение артериального давления",
    advice: "Сочетание противопоказано. Нитраты не раньше чем через 24 часа после силденафила.",
    source: "Sildenafil SmPC 4.3, 4.5",
  },
  {
    key: "acei-arb+potassium-sparing",
    a: ACEI_ARB,
    b: POTASSIUM_SPARING,
    severity: "MODERATE",
    mechanism: "Риск гиперкалиемии, особенно при сниженной функции почек",
    advice: "Контроль калия и креатинина в начале терапии и регулярно далее.",
    source: "Spironolactone SmPC 4.4, 4.5; ESC heart failure guidelines (MRA monitoring)",
  },
  {
    key: "potassium-sparing+potassium",
    a: POTASSIUM_SPARING,
    b: POTASSIUM_SUPPLEMENTS,
    severity: "MAJOR",
    mechanism: "Риск тяжёлой гиперкалиемии",
    advice: "Препараты калия на фоне спиронолактона не назначать без контроля калия крови.",
    source: "Spironolactone SmPC 4.4, 4.5 (potassium supplements)",
  },
  {
    key: "anticoagulant+bleeding-risk",
    a: ANTICOAGULANTS,
    b: BLEEDING_RISK,
    severity: "MAJOR",
    mechanism: "Антикоагулянт вместе с НПВС или антиагрегантом: высокий риск кровотечений",
    advice: "Избегать. Для обезболивания предпочесть парацетамол. Если сочетание нужно: гастропротекция и контроль.",
    source: "Warfarin SmPC 4.5; rivaroxaban / apixaban / dabigatran SmPC 4.4, 4.5",
  },
  {
    key: "warfarin+amiodarone",
    a: VKA,
    b: AMIODARONE,
    severity: "MAJOR",
    mechanism: "Амиодарон тормозит метаболизм варфарина: МНО растёт в течение нескольких недель",
    advice: "Снизить дозу варфарина на 30-50% и часто контролировать МНО.",
    source: "Warfarin SmPC 4.5; amiodarone SmPC 4.5",
  },
  {
    key: "warfarin+cyp2c9-antiinfective",
    a: VKA,
    b: CYP2C9_INHIBITOR_ANTIINFECTIVES,
    severity: "MAJOR",
    mechanism: "Ингибирование CYP2C9: резкий рост МНО и риск кровотечения",
    advice: "Выбрать другой препарат или снизить дозу варфарина и проверить МНО через 3-5 дней.",
    source: "Warfarin SmPC 4.5 (metronidazole, fluconazole, co-trimoxazole)",
  },
  {
    key: "ssri-snri+bleeding",
    a: SEROTONERGIC_AD,
    b: union(BLEEDING_RISK, ANTICOAGULANTS),
    severity: "MODERATE",
    mechanism: "СИОЗС и СИОЗСН нарушают агрегацию тромбоцитов: выше риск кровотечений, прежде всего из ЖКТ",
    advice: "При длительном сочетании рассмотреть ингибитор протонной помпы, предупредить пациента.",
    source: "SSRI / SNRI SmPC 4.4, 4.5 (haemorrhage)",
  },
  {
    key: "simvastatin+cyp3a4",
    a: SIMVASTATIN,
    b: STRONG_CYP3A4_INHIBITORS,
    severity: "CONTRAINDICATED",
    mechanism: "Ингибирование CYP3A4: концентрация симвастатина многократно растёт, риск рабдомиолиза",
    advice: "Приостановить симвастатин на время курса или выбрать другой препарат.",
    source: "Simvastatin SmPC 4.3",
  },

  // Movement disorders and migraine.
  {
    key: "metoclopramide+dopaminergic",
    a: METOCLOPRAMIDE,
    b: DOPAMINERGIC,
    severity: "CONTRAINDICATED",
    mechanism:
      "Метоклопрамид блокирует дофаминовые рецепторы: взаимный антагонизм с леводопой и агонистами дофамина, ухудшение паркинсонизма",
    advice: "Сочетание противопоказано. Против тошноты при паркинсонизме выбрать домперидон.",
    source: "Metoclopramide SmPC 4.3 (EMA referral 2013)",
  },
  {
    key: "d2-antipsychotic+dopaminergic",
    a: D2_BLOCKING_ANTIPSYCHOTICS,
    b: DOPAMINERGIC,
    severity: "MAJOR",
    mechanism: "Взаимный антагонизм: антипсихотик блокирует действие леводопы и агонистов дофамина",
    advice: "Избегать сочетания, при паркинсонизме подобрать другой препарат.",
    source: "Haloperidol SmPC 4.5; tiapride SmPC 4.3 (levodopa, dopamine agonists)",
  },
  {
    key: "propranolol+rizatriptan",
    a: PROPRANOLOL,
    b: RIZATRIPTAN,
    severity: "MODERATE",
    mechanism: "Пропранолол повышает концентрацию ризатриптана примерно на 70%",
    advice: "Ризатриптан по 5 мг, не более 3 доз в сутки.",
    source: "Rizatriptan (Maxalt) SmPC 4.2, 4.5",
  },
  {
    key: "cholinesterase-inhibitor+anticholinergic",
    a: CHOLINESTERASE_INHIBITORS,
    b: ANTICHOLINERGIC_ANTIPARKINSON,
    severity: "MODERATE",
    mechanism: "Противоположное действие: холинолитик ослабляет эффект ингибитора холинэстеразы",
    advice: "Избегать сочетания, особенно при когнитивных нарушениях.",
    source: "Galantamine / donepezil / rivastigmine SmPC 4.5 (anticholinergics)",
  },
];

/**
 * Every rule that fires for the basket, one hit per (pair, rule). A rule
 * whose two sides overlap («два серотонинергических антидепрессанта») needs
 * two different drugs, never a drug paired with itself.
 */
export function findRuleInteractions<D extends RuleDrug>(
  drugs: D[],
): { rule: InteractionRule; drugA: D; drugB: D }[] {
  const out: { rule: InteractionRule; drugA: D; drugB: D }[] = [];
  for (let i = 0; i < drugs.length; i += 1) {
    for (let j = i + 1; j < drugs.length; j += 1) {
      const x = drugs[i];
      const y = drugs[j];
      if (x.id === y.id) continue;
      for (const rule of INTERACTION_RULES) {
        if (drugInClass(x, rule.a) && drugInClass(y, rule.b)) {
          out.push({ rule, drugA: x, drugB: y });
        } else if (drugInClass(y, rule.a) && drugInClass(x, rule.b)) {
          out.push({ rule, drugA: y, drugB: x });
        }
      }
    }
  }
  return out;
}

/** The drug takes part in at least one class rule. */
export function isCoveredByRules(drug: RuleDrug): boolean {
  return INTERACTION_RULES.some(
    (r) => drugInClass(drug, r.a) || drugInClass(drug, r.b),
  );
}
