/**
 * Phase G4 — Clinical Decision Support engine.
 *
 * Given a list of free-text prescription lines (as stored in
 * VisitNote.prescriptions[]), this engine resolves each line to a Drug
 * row (best-effort INN/nameRu prefix match), then emits warnings:
 *
 *   - ALLERGY              — patient-recorded allergy substance matches the drug
 *   - INTERACTION          — known DrugInteraction pair in basket
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
    where: { active: true },
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
    return { warnings: [], resolvedDrugs: [], unresolvedLines: unresolved };
  }

  const drugIds = resolved.map((d) => d.id);

  const [allergies, patient, interactions] = await Promise.all([
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
  ]);

  const warnings: CdsWarning[] = [];

  // ── Allergies ────────────────────────────────────────────────────────
  for (const allergy of allergies) {
    const sub = normaliseToken(allergy.substance);
    if (!sub) continue;
    for (const drug of resolved) {
      const inn = normaliseToken(drug.inn);
      const nameRu = normaliseToken(drug.nameRu);
      // Match if the allergy substance string contains, or is contained in,
      // the INN, the RU name or any brand name ("Конкор" → bisoprolol).
      // Cheap & forgiving.
      const matches =
        inn.includes(sub) ||
        sub.includes(inn) ||
        nameRu.includes(sub) ||
        sub.includes(nameRu) ||
        (drug.brandNames ?? []).some((b) => {
          const nb = normaliseToken(b);
          return !!nb && (nb.includes(sub) || sub.includes(nb));
        });
      if (matches) {
        const severityFromAllergy =
          allergy.severity === "SEVERE"
            ? "CONTRAINDICATED"
            : allergy.severity === "MODERATE"
              ? "MAJOR"
              : "MODERATE";
        warnings.push({
          kind: "ALLERGY",
          severity: severityFromAllergy,
          title: `Аллергия: ${allergy.substance}`,
          detail: allergy.reaction
            ? `Реакция в анамнезе: ${allergy.reaction}. Не назначать.`
            : "Зафиксирована аллергия. Не назначать.",
          drugA: { id: drug.id, nameRu: drug.nameRu, inn: drug.inn },
        });
      }
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

  // ── Duplicate class (ATC 5-char prefix stacking) ─────────────────────
  // Skip pairs we already flagged via the curated interactions table.
  const flaggedPairs = new Set(
    interactions.map((it) => [it.drugAId, it.drugBId].sort().join("|")),
  );
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

  return { warnings, resolvedDrugs: resolved, unresolvedLines: unresolved };
}
