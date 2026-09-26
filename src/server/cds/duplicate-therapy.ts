/**
 * Duplicate therapy check for the CDS engine (audit G4-12).
 *
 * The first version flagged any two drugs sharing the 5-character ATC
 * prefix. That is wrong both ways:
 *   - WHO parks unrelated drugs in residual «other» groups ending in X:
 *     N03AX holds lamotrigine, levetiracetam and topiramate, N06BX piracetam,
 *     citicoline and phenibut, N05BX afobazole. Standard antiepileptic
 *     polytherapy and the usual nootropic pairs showed «Один класс ATC» on
 *     every visit, and doctors learned to click past it;
 *   - real duplicates slipped through: two NSAIDs from different subgroups
 *     (ibuprofen M01AE + diclofenac M01AB), extension rows that carry no ATC
 *     (clonazepam, eletriptan), a combination next to its own component
 *     («Лозартан» + «Гидрохлоротиазид + лозартан»), and the same substance on
 *     two lines («Ибупрофен» + «Нурофен»), which the engine silently merged.
 *
 * Now a drug belongs to:
 *   - the curated classes below, where taking two members at once is almost
 *     never intended (matched by ATC and by catalog id, like the interaction
 *     rules), and
 *   - its ATC level 4 group, unless that group is a residual X group.
 * Sharing a substance is its own, stronger warning.
 */
import {
  ANTICOAGULANTS,
  BENZODIAZEPINES,
  NSAIDS,
  SSRI,
  TRIPTANS,
  drugInClass,
  type DrugClass,
} from "./interaction-rules";
import { drugNameKey } from "./drug-text-match";

export type DuplicateDrug = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
};

type TherapyClass = { key: string; labelRu: string; cls: DrugClass };

export const DUPLICATE_CLASSES: TherapyClass[] = [
  { key: "NSAID", labelRu: "НПВС", cls: NSAIDS },
  { key: "BENZODIAZEPINE", labelRu: "бензодиазепины", cls: BENZODIAZEPINES },
  { key: "TRIPTAN", labelRu: "триптаны", cls: TRIPTANS },
  { key: "SSRI", labelRu: "СИОЗС", cls: SSRI },
  {
    key: "STATIN",
    labelRu: "статины",
    cls: { atc: ["C10AA", "C10BA", "C10BX"], ids: ["simvastatin"] },
  },
  {
    key: "ACEI",
    labelRu: "ингибиторы АПФ",
    cls: {
      atc: ["C09A", "C09B"],
      ids: ["enalapril", "lisinopril", "captopril", "ramipril", "perindopril"],
    },
  },
  {
    key: "ARB",
    labelRu: "сартаны",
    cls: {
      atc: ["C09C", "C09D"],
      ids: ["losartan", "valsartan", "telmisartan", "irbesartan"],
    },
  },
  {
    key: "PPI",
    labelRu: "ингибиторы протонной помпы",
    cls: { atc: ["A02BC"], ids: ["esomeprazole", "lansoprazole"] },
  },
  {
    key: "BETA_BLOCKER",
    labelRu: "бета-блокаторы",
    cls: { atc: ["C07"], ids: ["carvedilol"] },
  },
  { key: "ANTICOAGULANT", labelRu: "антикоагулянты", cls: ANTICOAGULANTS },
  {
    // R06AX is an X group, but a coherent one: every member is a systemic
    // H1 antihistamine (loratadine, desloratadine, ketotifen…).
    key: "H1_ANTIHISTAMINE",
    labelRu: "антигистаминные",
    cls: { atc: ["R06A"], ids: ["ketotifen", "ebastine", "rupatadine"] },
  },
  {
    // Same for M03BX: tolperisone, tizanidine and baclofen are all centrally
    // acting muscle relaxants.
    key: "CENTRAL_MUSCLE_RELAXANT",
    labelRu: "центральные миорелаксанты",
    cls: { atc: ["M03B"], ids: ["tizanidine-mr", "thiocolchicoside", "orphenadrine"] },
  },
];

function atcOf(d: DuplicateDrug): string {
  return d.atcCode?.trim().toUpperCase() ?? "";
}

/** The classes a drug counts in for the duplicate check, with their titles. */
export function duplicateClassesOf(
  d: DuplicateDrug,
): { key: string; title: string }[] {
  const out = DUPLICATE_CLASSES.filter((c) => drugInClass(d, c.cls)).map((c) => ({
    key: c.key,
    title: `Один класс: ${c.labelRu}`,
  }));
  const atc = atcOf(d);
  // «N03AX», «N06BX»: residual groups of unrelated drugs, not a class.
  if (atc.length >= 5 && atc[4] !== "X") {
    const l4 = atc.slice(0, 5);
    out.push({ key: `atc:${l4}`, title: `Один класс ATC: ${l4}` });
  }
  return out;
}

/** The first class two drugs share, or null. */
export function sharedDuplicateClass(
  a: DuplicateDrug,
  b: DuplicateDrug,
): { key: string; title: string } | null {
  const bKeys = new Set(duplicateClassesOf(b).map((c) => c.key));
  return duplicateClassesOf(a).find((c) => bKeys.has(c.key)) ?? null;
}

// Solutions, solvents, vitamins and minerals share components (sodium
// chloride, pyridoxine) without that being a double dose worth a warning.
const NO_COMPONENT_MATCH_ATC = ["B05", "V07", "A11", "A12"];

/** Active substances by name: «Гидрохлоротиазид + лозартан» → both. */
function componentKeys(d: DuplicateDrug): string[] {
  const names = [d.nameRu.replace(/\([^)]*\)/g, " ")];
  if (!/[_:]/.test(d.inn)) names.push(d.inn);
  return names
    .flatMap((n) => n.split(/\s*\+\s*/))
    .map(drugNameKey)
    .filter((k) => k.length >= 5);
}

/**
 * Two different catalog rows that put the same substance in the basket: the
 * same full ATC code (the register holds one substance under several rows),
 * or a shared component of a combination.
 */
export function shareSubstance(a: DuplicateDrug, b: DuplicateDrug): boolean {
  if (a.id === b.id) return true;
  const aa = atcOf(a);
  if (aa.length >= 7 && aa === atcOf(b)) return true;
  if ([aa, atcOf(b)].some((c) => NO_COMPONENT_MATCH_ATC.some((p) => c.startsWith(p)))) {
    return false;
  }
  const bKeys = new Set(componentKeys(b));
  return componentKeys(a).some((k) => bKeys.has(k));
}
