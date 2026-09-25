/**
 * Phase G4 — Clinical Decision Support engine.
 *
 * Given a list of free-text prescription lines (as stored in
 * VisitNote.prescriptions[]), this engine resolves each line to a Drug
 * row (best-effort INN/nameRu prefix match), then emits warnings:
 *
 *   - ALLERGY              — recorded (or pre-visit questionnaire) allergy
 *                            matches the drug by substance or by class
 *                            (see allergy-match.ts)
 *   - INTERACTION          — known DrugInteraction pair in basket, or a
 *                            class-level rule (see interaction-rules.ts)
 *   - DUPLICATE_CLASS      — two drugs share the 5-char ATC prefix (class stack)
 *   - PREGNANCY            — pregnancyCat D/X for female patients of fertile age
 *   - DIAGNOSIS_RISK       — interaction's riskDiagnoses matches active dx
 *
 * Free-text lines that don't resolve to a Drug row are reported back as
 * `unresolvedLines` so the UI can show a "manual entry — CDS skipped" hint.
 * This is deliberately best-effort: the catalog drawer + dosage builder
 * always emit the drug nameRu first, so resolution works for the canonical
 * path; manually typed lines may slip through, which is acceptable for MVP.
 */
import { prisma } from "@/lib/prisma";
import { parsePreVisitData } from "@/lib/patient-experience/pre-visit";

import { matchAllergy } from "./allergy-match";
import { findRuleInteractions, isCoveredByRules } from "./interaction-rules";

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
   * Ф2 — drug ids from structured prescription rows. These skip text
   * resolution entirely: the row was picked from the catalog, so the id is
   * authoritative. Free-text/custom rows still go through prescriptionLines.
   */
  drugIds?: string[];
  diagnosisCode: string | null;
};

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

function firstToken(line: string): string {
  const t = normaliseToken(line).split(" ")[0];
  return t ?? "";
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

/**
 * Resolve prescription lines to Drug rows. Match strategy:
 *   1. exact INN match on first token (e.g. "ibuprofen 400 мг…" → ibuprofen)
 *   2. nameRu starts-with on the line (case-insensitive)
 *   3. brand name match against DrugBrand.name (case-insensitive)
 */
async function resolveDrugs(
  lines: string[],
): Promise<{ resolved: ResolvedDrug[]; unresolved: number[] }> {
  const resolved: ResolvedDrug[] = [];
  const unresolved: number[] = [];
  if (lines.length === 0) return { resolved, unresolved };

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

  // Pre-index for fast lookup.
  const byInn = new Map<string, (typeof allDrugs)[number]>();
  const byNamePrefix: { prefix: string; drug: (typeof allDrugs)[number] }[] = [];
  const byBrand: { brand: string; drug: (typeof allDrugs)[number] }[] = [];
  for (const d of allDrugs) {
    byInn.set(d.inn.toLowerCase(), d);
    byNamePrefix.push({ prefix: d.nameRu.toLowerCase(), drug: d });
    for (const b of d.brands) {
      byBrand.push({ brand: b.name.toLowerCase(), drug: d });
    }
  }
  // Sort by length descending so "ацетилсалициловая кислота" wins over "ацетил".
  byNamePrefix.sort((a, b) => b.prefix.length - a.prefix.length);
  byBrand.sort((a, b) => b.brand.length - a.brand.length);

  lines.forEach((line, idx) => {
    const normalised = normaliseToken(line);
    if (!normalised) {
      unresolved.push(idx);
      return;
    }

    // 1) INN as the first token
    const innHit = byInn.get(firstToken(line));
    if (innHit) {
      resolved.push(toResolved(innHit, idx));
      return;
    }

    // 2) nameRu starts-with on the line text
    const nameHit = byNamePrefix.find((n) => normalised.startsWith(n.prefix));
    if (nameHit) {
      resolved.push(toResolved(nameHit.drug, idx));
      return;
    }

    // 3) brand starts-with
    const brandHit = byBrand.find((b) => normalised.startsWith(b.brand));
    if (brandHit) {
      resolved.push(toResolved(brandHit.drug, idx));
      return;
    }

    unresolved.push(idx);
  });

  // Dedupe by drug id but keep the first occurrence.
  const seen = new Set<string>();
  const deduped = resolved.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
  return { resolved: deduped, unresolved };
}

function ageFromBirthDate(birthDate: Date | null): number | null {
  if (!birthDate) return null;
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

export async function runDrugCheck(input: CdsCheckInput): Promise<CdsCheckResult> {
  const { clinicId, patientId, prescriptionLines, diagnosisCode } = input;

  const { resolved: textResolved, unresolved } =
    await resolveDrugs(prescriptionLines);

  // Ф2 — id-pinned drugs from structured rows resolve directly, no text
  // matching. They take precedence in the dedupe below.
  const pinnedIds = [...new Set(input.drugIds ?? [])];
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
  for (const d of pinnedDrugs) {
    seenIds.add(d.id);
    resolved.push(toResolved(d, -1));
  }
  for (const d of textResolved) {
    if (seenIds.has(d.id)) continue;
    seenIds.add(d.id);
    resolved.push(d);
  }

  if (resolved.length === 0) {
    return {
      warnings: [],
      resolvedDrugs: [],
      unresolvedLines: unresolved,
      noInteractionData: [],
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
        select: { birthDate: true, gender: true },
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

  // ── Duplicate class (ATC 5-char prefix stacking) ─────────────────────
  // Skip pairs we already flagged via a curated pair or a class rule.
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i];
      const b = resolved[j];
      if (!a.atcCode || !b.atcCode) continue;
      const aPrefix = a.atcCode.slice(0, 5);
      const bPrefix = b.atcCode.slice(0, 5);
      if (aPrefix !== bPrefix) continue;
      const pairKey = [a.id, b.id].sort().join("|");
      if (flaggedPairs.has(pairKey)) continue;
      warnings.push({
        kind: "DUPLICATE_CLASS",
        severity: "MODERATE",
        title: `Один класс ATC: ${aPrefix}`,
        detail: "Препараты относятся к одному классу. Проверьте необходимость дублирования.",
        drugA: { id: a.id, nameRu: a.nameRu, inn: a.inn },
        drugB: { id: b.id, nameRu: b.nameRu, inn: b.inn },
      });
    }
  }

  // ── Pregnancy category D/X ───────────────────────────────────────────
  const age = ageFromBirthDate(patient?.birthDate ?? null);
  const fertileFemale =
    patient?.gender === "FEMALE" && age !== null && age >= 12 && age <= 55;
  if (fertileFemale) {
    for (const drug of resolved) {
      if (drug.pregnancyCat === "D" || drug.pregnancyCat === "X") {
        warnings.push({
          kind: "PREGNANCY",
          severity: drug.pregnancyCat === "X" ? "CONTRAINDICATED" : "MAJOR",
          title: `Категория беременности ${drug.pregnancyCat}: ${drug.nameRu}`,
          detail:
            drug.pregnancyCat === "X"
              ? "Противопоказан при беременности. Уточнить статус и исключить беременность."
              : "Применять только при крайней необходимости у женщин фертильного возраста. Исключить беременность.",
          drugA: { id: drug.id, nameRu: drug.nameRu, inn: drug.inn },
        });
      }
    }
  }

  warnings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return {
    warnings,
    resolvedDrugs: resolved,
    unresolvedLines: unresolved,
    noInteractionData,
  };
}
