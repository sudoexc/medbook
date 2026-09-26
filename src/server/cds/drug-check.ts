/**
 * Phase G4 — Clinical Decision Support engine.
 *
 * Given a list of free-text prescription lines (as stored in
 * VisitNote.prescriptions[]), this engine resolves each line to a Drug
 * row (whole-word match on names, brands and INNs, see drug-text-match.ts),
 * then emits warnings:
 *
 *   - ALLERGY              — recorded (or pre-visit questionnaire) allergy
 *                            matches the drug by substance or by class
 *                            (see allergy-match.ts)
 *   - INTERACTION          — known DrugInteraction pair in basket, or a
 *                            class-level rule (see interaction-rules.ts)
 *   - DUPLICATE_CLASS      — one substance twice, or two drugs of one
 *                            therapeutic class (see duplicate-therapy.ts)
 *   - PREGNANCY            — category D/X for a patient who may be pregnant
 *                            (see pregnancy.ts)
 *   - DIAGNOSIS_RISK       — interaction's riskDiagnoses matches active dx
 *
 * Free-text lines that don't resolve to a Drug row are reported back as
 * `unresolvedLines` so the UI can show a "manual entry — CDS skipped" hint.
 */
import { prisma } from "@/lib/prisma";
import { parsePreVisitData } from "@/lib/patient-experience/pre-visit";

import { matchAllergy } from "./allergy-match";
import { buildDrugTextIndex, matchDrugLine } from "./drug-text-match";
import { shareSubstance, sharedDuplicateClass } from "./duplicate-therapy";
import { findRuleInteractions, isCoveredByRules } from "./interaction-rules";
import {
  effectivePregnancyCat,
  pregnancyContext,
  pregnancyWarning,
} from "./pregnancy";

export type CdsWarningKind =
  | "ALLERGY"
  | "INTERACTION"
  | "DUPLICATE_CLASS"
  | "PREGNANCY"
  | "DIAGNOSIS_RISK";

export type CdsSeverity = "MINOR" | "MODERATE" | "MAJOR" | "CONTRAINDICATED";

export type ResolvedDrug = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: "A" | "B" | "C" | "D" | "X" | "UNKNOWN";
  /**
   * Index into the original prescriptions[] array that resolved here.
   * -1 for drugs pinned directly by id (Ф2 structured rows).
   */
  lineIndex: number;
  /** Brand names — used for allergy substance matching ("Конкор" → bisoprolol). */
  brandNames?: string[];
};

export type CdsWarning = {
  kind: CdsWarningKind;
  severity: CdsSeverity;
  title: string;
  detail: string;
  drugA: { id: string; nameRu: string; inn: string };
  drugB?: { id: string; nameRu: string; inn: string };
};

export type CdsCheckInput = {
  clinicId: string;
  patientId: string;
  prescriptionLines: string[];
  /**
   * Ф2 — structured prescription rows, one entry per row. These skip text
   * resolution entirely: the row was picked from the catalog, so the id is
   * authoritative. Free-text/custom rows still go through prescriptionLines.
   * The row's label comes along because it says which name the drug was
   * picked under: «Нурофен (ибупрофен)» next to «Ибупрофен» is one
   * substance twice (audit G4-12), and ids alone cannot tell.
   */
  drugRows?: PinnedDrugRow[];
  /**
   * Ф2 — bare ids of structured rows, as a client on the previous build
   * sends them. Each counts as a row under the drug's own name.
   */
  drugIds?: string[];
  diagnosisCode: string | null;
};

/** A structured prescription row: the catalog drug and the row's label. */
export type PinnedDrugRow = { id: string; displayName?: string | null };

export type CdsCheckResult = {
  warnings: CdsWarning[];
  resolvedDrugs: ResolvedDrug[];
  unresolvedLines: number[];
  /**
   * Ids of resolved drugs that no curated pair and no class rule covers.
   * For these the engine cannot say «no conflicts», it simply does not know
   * (audit G4-01): the card must say so instead of showing an all-clear.
   */
  noInteractionData: string[];
  /**
   * Ids of resolved drugs with no known pregnancy category, reported only
   * when the patient may be pregnant (audit G4-13): the card says the
   * pregnancy check was not done for them instead of an all-clear.
   */
  noPregnancyData: string[];
};

const SEVERITY_RANK: Record<CdsSeverity, number> = {
  CONTRAINDICATED: 4,
  MAJOR: 3,
  MODERATE: 2,
  MINOR: 1,
};

function normaliseToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/giu, " ")
    .trim();
}

type DrugPick = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: ResolvedDrug["pregnancyCat"];
  brands: { name: string }[];
};

function toResolved(d: DrugPick, lineIndex: number): ResolvedDrug {
  return {
    id: d.id,
    inn: d.inn,
    nameRu: d.nameRu,
    atcCode: d.atcCode,
    pregnancyCat: d.pregnancyCat,
    lineIndex,
    brandNames: d.brands.map((b) => b.name),
  };
}

/** One prescription line that named a catalog drug, and how it named it. */
type LineHit = {
  drug: DrugPick;
  lineIndex: number;
  /** The brand or name as the line spelled it («Нурофен»). */
  label: string;
  /** `brand:<key>` or `generic`, see DrugLineMatch. */
  nameKey: string;
};

/**
 * Resolve prescription lines to Drug rows (see drug-text-match.ts for the
 * matching rules). Every hit is returned, not one per drug: two lines naming
 * the same substance differently («Ибупрофен» and «Нурофен») are a double
 * dose the engine must report, not merge away (audit G4-12).
 */
async function resolveDrugs(
  lines: string[],
): Promise<{ hits: LineHit[]; unresolved: number[] }> {
  const hits: LineHit[] = [];
  const unresolved: number[] = [];
  if (lines.length === 0) return { hits, unresolved };

  const allDrugs = await prisma.drug.findMany({
    // Rows a doctor quick-added for a clinic («clinic:…» key) carry a bare
    // name and no clinical data. Letting them into text resolution would let
    // «Кеторол 10 мг» shadow ketorolac — and, Drug being cross-tenant, in
    // every clinic — and silence allergy/interaction warnings.
    where: { active: true, NOT: { inn: { startsWith: "clinic:" } } },
    select: {
      id: true,
      inn: true,
      nameRu: true,
      atcCode: true,
      pregnancyCat: true,
      brands: { select: { name: true } },
    },
  });
  const index = buildDrugTextIndex(allDrugs);

  lines.forEach((line, idx) => {
    const m = matchDrugLine(index, line);
    if (!m) {
      unresolved.push(idx);
      return;
    }
    hits.push({ drug: m.drug, lineIndex: idx, label: m.label, nameKey: m.nameKey });
  });
  return { hits, unresolved };
}

/**
 * Which name a structured row names its drug by, in the text matcher's
 * terms: `brand:<key>` for «Нурофен (ибупрофен)», `generic` for
 * «Ибупрофен». The label is matched against that one drug's own names, so
 * it can only pick among them; a label that names none of them (a doctor's
 * own wording kept from his shortlist) counts as the drug's own name, as
 * every pinned row did before.
 */
function pinnedRowName(
  drug: DrugPick,
  displayName: string | null | undefined,
): { nameKey: string; label: string } {
  const m = displayName
    ? matchDrugLine(buildDrugTextIndex([drug]), displayName)
    : null;
  return m
    ? { nameKey: m.nameKey, label: m.label }
    : { nameKey: "generic", label: drug.nameRu };
}

export async function runDrugCheck(input: CdsCheckInput): Promise<CdsCheckResult> {
  const { clinicId, patientId, prescriptionLines, diagnosisCode } = input;

  const { hits: textHits, unresolved } = await resolveDrugs(prescriptionLines);

  // Ф2 — id-pinned drugs from structured rows resolve directly, no text
  // matching. They take precedence in the dedupe below. Rows are kept one
  // per row (not one per id) so their names can be compared.
  const pinnedRows: PinnedDrugRow[] = [
    ...(input.drugRows ?? []),
    ...(input.drugIds ?? []).map((id) => ({ id })),
  ];
  const pinnedIds = [...new Set(pinnedRows.map((r) => r.id))];
  const pinnedDrugs =
    pinnedIds.length > 0
      ? await prisma.drug.findMany({
          where: { id: { in: pinnedIds } },
          select: {
            id: true,
            inn: true,
            nameRu: true,
            atcCode: true,
            pregnancyCat: true,
            brands: { select: { name: true } },
          },
        })
      : [];

  const seenIds = new Set<string>();
  const resolved: ResolvedDrug[] = [];
  // Every name each drug appears under: a structured row or a text line
  // counts as the brand or name it is labelled with.
  const namesById = new Map<string, Map<string, string>>();
  const noteName = (id: string, nameKey: string, label: string) => {
    const names = namesById.get(id) ?? new Map<string, string>();
    if (!names.has(nameKey)) names.set(nameKey, label);
    namesById.set(id, names);
  };
  const pinnedById = new Map(pinnedDrugs.map((d) => [d.id, d]));
  for (const row of pinnedRows) {
    const d = pinnedById.get(row.id);
    if (!d) continue;
    const { nameKey, label } = pinnedRowName(d, row.displayName);
    noteName(d.id, nameKey, label);
    if (seenIds.has(d.id)) continue;
    seenIds.add(d.id);
    resolved.push(toResolved(d, -1));
  }
  for (const h of textHits) {
    noteName(h.drug.id, h.nameKey, h.label);
    if (seenIds.has(h.drug.id)) continue;
    seenIds.add(h.drug.id);
    resolved.push(toResolved(h.drug, h.lineIndex));
  }

  if (resolved.length === 0) {
    return {
      warnings: [],
      resolvedDrugs: [],
      unresolvedLines: unresolved,
      noInteractionData: [],
      noPregnancyData: [],
    };
  }

  const drugIds = resolved.map((d) => d.id);

  const [allergies, patient, interactions, coveredRows, preVisit] =
    await Promise.all([
      prisma.patientAllergy.findMany({
        where: { clinicId, patientId },
        select: { id: true, substance: true, severity: true, reaction: true },
      }),
      prisma.patient.findFirst({
        where: { id: patientId, clinicId },
        select: { birthDate: true, gender: true, fullName: true },
      }),
      prisma.drugInteraction.findMany({
        where: {
          OR: [
            { drugAId: { in: drugIds }, drugBId: { in: drugIds } },
          ],
        },
        include: {
          drugA: { select: { id: true, nameRu: true, inn: true } },
          drugB: { select: { id: true, nameRu: true, inn: true } },
        },
      }),
      // Which of the basket's drugs appear in ANY curated pair: a drug with
      // no pair and no class rule has no interaction data at all.
      prisma.drugInteraction.findMany({
        where: {
          OR: [{ drugAId: { in: drugIds } }, { drugBId: { in: drugIds } }],
        },
        select: { drugAId: true, drugBId: true },
      }),
      // Allergies the patient listed in the Mini App questionnaire before the
      // visit (audit G4-02). They are not in PatientAllergy until someone
      // copies them over, and the doctor must not miss them meanwhile.
      prisma.appointment.findFirst({
        where: { clinicId, patientId, preVisitSubmittedAt: { not: null } },
        orderBy: { preVisitSubmittedAt: "desc" },
        select: { preVisitData: true },
      }),
    ]);

  const warnings: CdsWarning[] = [];

  // ── Allergies ────────────────────────────────────────────────────────
  type AllergyEntry = {
    substance: string;
    severity: string | null;
    reaction: string | null;
    patientReported: boolean;
  };
  const allergyEntries: AllergyEntry[] = allergies.map((a) => ({
    substance: a.substance,
    severity: a.severity,
    reaction: a.reaction,
    patientReported: false,
  }));
  const recordedKeys = new Set(
    allergies.map((a) => normaliseToken(a.substance)),
  );
  for (const raw of parsePreVisitData(preVisit?.preVisitData)?.allergies ?? []) {
    const key = normaliseToken(raw);
    if (!key || recordedKeys.has(key)) continue;
    recordedKeys.add(key);
    allergyEntries.push({
      substance: raw,
      severity: null,
      reaction: null,
      patientReported: true,
    });
  }

  for (const allergy of allergyEntries) {
    for (const drug of resolved) {
      const match = matchAllergy(allergy.substance, drug);
      if (!match) continue;
      // Unverified questionnaire entries have no recorded severity: treat
      // them as serious until the doctor has asked the patient.
      const severity: CdsSeverity = allergy.patientReported
        ? "MAJOR"
        : allergy.severity === "SEVERE"
          ? "CONTRAINDICATED"
          : allergy.severity === "MODERATE"
            ? "MAJOR"
            : "MODERATE";
      const why =
        match.kind === "CLASS"
          ? match.namedClass
            ? `${drug.nameRu} относится к группе «${match.cls.labelRu}». `
            : `${drug.nameRu} из той же группы, что и «${allergy.substance}» (${match.cls.labelRu}): возможна перекрёстная реакция. `
          : "";
      const history = allergy.patientReported
        ? "Указано пациентом в анкете перед визитом, уточните перед назначением."
        : allergy.reaction
          ? `Реакция в анамнезе: ${allergy.reaction}. Не назначать.`
          : "Зафиксирована аллергия. Не назначать.";
      warnings.push({
        kind: "ALLERGY",
        severity,
        title: allergy.patientReported
          ? `Аллергия со слов пациента: ${allergy.substance}`
          : `Аллергия: ${allergy.substance}`,
        detail: `${why}${history}`,
        drugA: { id: drug.id, nameRu: drug.nameRu, inn: drug.inn },
      });
    }
  }

  // ── Interactions (curated pairs) ─────────────────────────────────────
  for (const it of interactions) {
    const diagnosisHits = diagnosisCode
      ? it.riskDiagnoses.some((p) =>
          diagnosisCode.toUpperCase().startsWith(p.toUpperCase()),
        )
      : false;
    warnings.push({
      kind: diagnosisHits ? "DIAGNOSIS_RISK" : "INTERACTION",
      severity: it.severity,
      title: diagnosisHits
        ? `Риск при ${diagnosisCode}: ${it.drugA.nameRu} + ${it.drugB.nameRu}`
        : `${it.drugA.nameRu} + ${it.drugB.nameRu}`,
      detail: it.mechanism ? `${it.mechanism}. ${it.advice}` : it.advice,
      drugA: it.drugA,
      drugB: it.drugB,
    });
  }

  // ── Interactions (class rules) ───────────────────────────────────────
  // A curated pair is more specific than a class rule, so it wins for the
  // same two drugs.
  const flaggedPairs = new Set(
    interactions.map((it) => [it.drugAId, it.drugBId].sort().join("|")),
  );
  const curatedPairs = new Set(flaggedPairs);
  for (const hit of findRuleInteractions(resolved)) {
    const pairKey = [hit.drugA.id, hit.drugB.id].sort().join("|");
    if (curatedPairs.has(pairKey)) continue;
    flaggedPairs.add(pairKey);
    warnings.push({
      kind: "INTERACTION",
      severity: hit.rule.severity,
      title: `${hit.drugA.nameRu} + ${hit.drugB.nameRu}`,
      detail: `${hit.rule.mechanism}. ${hit.rule.advice}`,
      drugA: { id: hit.drugA.id, nameRu: hit.drugA.nameRu, inn: hit.drugA.inn },
      drugB: { id: hit.drugB.id, nameRu: hit.drugB.nameRu, inn: hit.drugB.inn },
    });
  }

  // ── Interaction coverage ─────────────────────────────────────────────
  const curatedIds = new Set(
    coveredRows.flatMap((r) => [r.drugAId, r.drugBId]),
  );
  const noInteractionData = resolved
    .filter((d) => !curatedIds.has(d.id) && !isCoveredByRules(d))
    .map((d) => d.id);

  // ── One substance twice ──────────────────────────────────────────────
  // Two rows or lines under different names of one drug («Ибупрофен 400 мг»
  // and «Нурофен 200 мг») are a double dose. The same name twice is left alone:
  // a split dose («Карбамазепин 200 мг утром», «… 400 мг вечером») is
  // written that way on purpose and the doctor sees both lines.
  for (const drug of resolved) {
    const labels = [...(namesById.get(drug.id)?.values() ?? [])];
    if (labels.length < 2) continue;
    warnings.push({
      kind: "DUPLICATE_CLASS",
      severity: "MAJOR",
      title: `Одно вещество дважды: ${drug.nameRu}`,
      detail: `${labels.map((l) => `«${l}»`).join(", ")}: это один и тот же препарат. Проверьте, не удваивается ли доза.`,
      drugA: { id: drug.id, nameRu: drug.nameRu, inn: drug.inn },
    });
  }
  // Two catalog rows with one substance: the register's twin of a curated
  // row, or a combination next to its own component.
  const substancePairs = new Set<string>();
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i];
      const b = resolved[j];
      if (!shareSubstance(a, b)) continue;
      substancePairs.add([a.id, b.id].sort().join("|"));
      warnings.push({
        kind: "DUPLICATE_CLASS",
        severity: "MAJOR",
        title: `Одно вещество дважды: ${a.nameRu} и ${b.nameRu}`,
        detail: "Препараты содержат одно и то же действующее вещество. Проверьте, не удваивается ли доза.",
        drugA: { id: a.id, nameRu: a.nameRu, inn: a.inn },
        drugB: { id: b.id, nameRu: b.nameRu, inn: b.inn },
      });
    }
  }

  // ── Duplicate class ──────────────────────────────────────────────────
  // Skip pairs already flagged via a curated pair, a class rule or a shared
  // substance.
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i];
      const b = resolved[j];
      const pairKey = [a.id, b.id].sort().join("|");
      if (flaggedPairs.has(pairKey) || substancePairs.has(pairKey)) continue;
      const shared = sharedDuplicateClass(a, b);
      if (!shared) continue;
      warnings.push({
        kind: "DUPLICATE_CLASS",
        severity: "MODERATE",
        title: shared.title,
        detail: "Препараты относятся к одному классу. Проверьте необходимость дублирования.",
        drugA: { id: a.id, nameRu: a.nameRu, inn: a.inn },
        drugB: { id: b.id, nameRu: b.nameRu, inn: b.inn },
      });
    }
  }

  // ── Pregnancy ────────────────────────────────────────────────────────
  // One warning per drug of category D/X (the catalog's own, or its class's
  // when the catalog is silent), for any patient who may be pregnant.
  const pregnancy = pregnancyContext(patient);
  for (const drug of resolved) {
    const w = pregnancyWarning(drug, pregnancy);
    if (w) warnings.push(w);
  }
  const noPregnancyData =
    pregnancy === "NONE"
      ? []
      : resolved
          .filter((d) => effectivePregnancyCat(d) === "UNKNOWN")
          .map((d) => d.id);

  warnings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return {
    warnings,
    resolvedDrugs: resolved,
    unresolvedLines: unresolved,
    noInteractionData,
    noPregnancyData,
  };
}
