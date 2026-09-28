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
 *   - DIAGNOSIS_RISK       — interaction's riskDiagnoses matches a diagnosis
 *                            of the patient, or the drug's own catalog
 *                            contraindications name a condition the patient
 *                            has on record (see contraindications.ts)
 *
 * Audit G4-03: the visit's prescriptions are no longer checked in a vacuum.
 * The patient's current therapy (running courses, medicines named in the
 * pre-visit questionnaire, see current-therapy.ts) is checked against every
 * new drug for interactions and duplicate therapy, and the diagnoses on the
 * card (visit, recorded, chronic) against every drug's contraindications.
 *
 * Audit G4-08: every drug is seen through its substances (see
 * substance-profile.ts), so a register row or a combination gets the
 * curated pairs, pregnancy category and contraindications of the substance
 * it contains, and the class rules see the diclofenac inside a combination.
 *
 * Free-text lines that don't resolve to a Drug row are reported back as
 * `unresolvedLines` so the UI can show a "manual entry — CDS skipped" hint.
 */
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { parsePreVisitData } from "@/lib/patient-experience/pre-visit";

import { matchAllergy, type AllergyDrug, type AllergyMatch } from "./allergy-match";
import {
  describeRecord,
  findContraindicationHits,
  icdCodeIn,
  patientCodes,
  type PatientCondition,
} from "./contraindications";
import {
  courseStart,
  isCourseCurrent,
  isLongTermTherapy,
  isQuestionnaireFresh,
  type CourseLike,
} from "./current-therapy";
import {
  buildDrugTextIndex,
  matchDrugLine,
  type DrugTextIndex,
} from "./drug-text-match";
import {
  NO_COMPONENT_MATCH_ATC,
  shareSubstance,
  sharedDuplicateClass,
} from "./duplicate-therapy";
import { isCoveredByRules, rulesBetween } from "./interaction-rules";
import {
  effectivePregnancyCat,
  pregnancyContext,
  pregnancyWarning,
} from "./pregnancy";
import {
  componentNames,
  contraindicationLines,
  fullAtc,
  strictestCategory,
  twinsOf,
} from "./substance-profile";

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
  /**
   * The visit being checked. Its own rows, once signed, are mirrored into
   * medication courses: those are this basket, not the patient's current
   * therapy, and must not be checked against themselves.
   */
  visitNoteId?: string | null;
  /** Clock for course ends and questionnaire age; tests pin it. */
  now?: Date;
};

/** A structured prescription row: the catalog drug and the row's label. */
export type PinnedDrugRow = { id: string; displayName?: string | null };

/** A drug the patient already takes, as the check counted it. */
export type CurrentTherapyDrug = {
  id: string;
  nameRu: string;
  inn: string;
  /** A running course, or a medicine named in the pre-visit questionnaire. */
  source: "COURSE" | "PATIENT_REPORTED";
  /** ISO start of the course, or when the questionnaire was sent. */
  since: string | null;
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
  /**
   * Ids of resolved drugs with no known pregnancy category, reported only
   * when the patient may be pregnant (audit G4-13): the card says the
   * pregnancy check was not done for them instead of an all-clear.
   */
  noPregnancyData: string[];
  /**
   * What the patient already takes and the new drugs were checked against
   * (audit G4-03). A drug of this visit is not repeated here: prescribing
   * it again is continuing it.
   */
  currentTherapy: CurrentTherapyDrug[];
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

const DRUG_SELECT = {
  id: true,
  inn: true,
  nameRu: true,
  atcCode: true,
  pregnancyCat: true,
  contraindications: true,
  brands: { select: { name: true } },
} as const;

type DrugPick = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: ResolvedDrug["pregnancyCat"];
  contraindications: string[];
  brands: { name: string }[];
};

/** Rows as read, with the arrays a partial select may leave out filled in. */
function pick(d: Omit<DrugPick, "contraindications" | "brands"> & {
  contraindications?: string[] | null;
  brands?: { name: string }[] | null;
}): DrugPick {
  return {
    id: d.id,
    inn: d.inn,
    nameRu: d.nameRu,
    atcCode: d.atcCode,
    pregnancyCat: d.pregnancyCat,
    contraindications: d.contraindications ?? [],
    brands: d.brands ?? [],
  };
}

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

function ref(d: { id: string; nameRu: string; inn: string }) {
  return { id: d.id, nameRu: d.nameRu, inn: d.inn };
}

/**
 * The whole searchable catalog, read at most once per check and only when
 * a text line, an unlinked course or a combination needs it.
 */
function catalogLoader() {
  let rows: Promise<DrugPick[]> | null = null;
  let full: DrugTextIndex<DrugPick> | null = null;
  let substances: DrugTextIndex<DrugPick> | null = null;
  const load = () =>
    (rows ??= prisma.drug
      .findMany({
        // Rows a doctor quick-added for a clinic («clinic:…» key) carry a bare
        // name and no clinical data. Letting them into text resolution would
        // let «Кеторол 10 мг» shadow ketorolac — and, Drug being cross-tenant,
        // in every clinic — and silence allergy/interaction warnings.
        where: { active: true, NOT: { inn: { startsWith: "clinic:" } } },
        select: DRUG_SELECT,
      })
      .then((found) => found.map(pick)));
  return {
    /** Every name, brand and INN: resolves a written line. */
    async textIndex(): Promise<DrugTextIndex<DrugPick>> {
      full ??= buildDrugTextIndex(await load());
      return full;
    },
    /**
     * Rows that carry an ATC code: what a combination's component or an
     * uncoded register row resolves to, so it brings class data along.
     */
    async substanceIndex(): Promise<DrugTextIndex<DrugPick>> {
      substances ??= buildDrugTextIndex(
        (await load()).filter((r) => r.atcCode?.trim()),
      );
      return substances;
    },
  };
}
type Catalog = ReturnType<typeof catalogLoader>;

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
  catalog: Catalog,
): Promise<{ hits: LineHit[]; unresolved: number[] }> {
  const hits: LineHit[] = [];
  const unresolved: number[] = [];
  if (lines.length === 0) return { hits, unresolved };

  const index = await catalog.textIndex();
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

/** A drug as the checks see it: the row and the substances it stands for. */
type CheckDrug = {
  drug: DrugPick;
  /** The row, its same-substance twins, its components and their twins. */
  profiles: DrugPick[];
  /** What it contains: its components, or the row itself. */
  substances: DrugPick[];
};

/** A drug the patient already takes, with where the check learned it. */
type ContextDrug = CheckDrug & {
  source: CurrentTherapyDrug["source"];
  since: Date | null;
};

function dedupeById(rows: DrugPick[]): DrugPick[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/** See substance-profile.ts: twins by full ATC, components by name. */
async function substanceViews(
  drugs: DrugPick[],
  catalog: Catalog,
): Promise<Map<string, CheckDrug>> {
  const componentsOf = new Map<string, DrugPick[]>();
  const needing = drugs.filter((d) => componentNames(d).length > 0);
  if (needing.length > 0) {
    const index = await catalog.substanceIndex();
    for (const d of needing) {
      const found: DrugPick[] = [];
      for (const name of componentNames(d)) {
        const m = matchDrugLine(index, name);
        if (m && m.drug.id !== d.id) found.push(m.drug);
      }
      componentsOf.set(d.id, dedupeById(found));
    }
  }

  const atcs = new Set<string>();
  for (const d of [...drugs, ...[...componentsOf.values()].flat()]) {
    const a = fullAtc(d.atcCode);
    if (a) atcs.add(a);
  }
  const donors =
    atcs.size > 0
      ? (
          await prisma.drug.findMany({
            where: {
              atcCode: { in: [...atcs] },
              active: true,
              NOT: { inn: { startsWith: "clinic:" } },
            },
            select: DRUG_SELECT,
          })
        )
          .map(pick)
          // Same filter in code: the read is by exact code, a twin must
          // match the full substance code exactly.
          .filter((r) => atcs.has(fullAtc(r.atcCode) ?? ""))
      : [];

  const out = new Map<string, CheckDrug>();
  for (const d of drugs) {
    const components = componentsOf.get(d.id) ?? [];
    out.set(d.id, {
      drug: d,
      profiles: dedupeById([
        d,
        ...twinsOf(d, donors),
        ...components.flatMap((c) => [c, ...twinsOf(c, donors)]),
      ]),
      substances: components.length > 0 ? components : [d],
    });
  }
  return out;
}

/**
 * Keys naming what a drug contains: each substance by id and by its full
 * ATC code. Solutions, vitamins and minerals are left out, as in
 * `shareSubstance`: sharing sodium chloride or pyridoxine is no double dose.
 */
function substanceKeys(cd: CheckDrug): Set<string> {
  const keys = new Set<string>();
  const excluded = (atc: string | null) =>
    !!atc && NO_COMPONENT_MATCH_ATC.some((p) => atc.toUpperCase().startsWith(p));
  if (excluded(cd.drug.atcCode)) return keys;
  for (const s of cd.substances) {
    if (excluded(s.atcCode)) continue;
    keys.add(`id:${s.id}`);
    const atc = fullAtc(s.atcCode);
    if (atc) keys.add(`atc:${atc}`);
  }
  return keys;
}

/** Same substance: the P2 name/ATC test, or a shared resolved substance. */
function sameSubstance(a: CheckDrug, b: CheckDrug): boolean {
  if (shareSubstance(a.drug, b.drug)) return true;
  const bKeys = substanceKeys(b);
  for (const k of substanceKeys(a)) if (bKeys.has(k)) return true;
  return false;
}

/** The first duplicate-therapy class any substances of the two share. */
function sharedClass(a: CheckDrug, b: CheckDrug) {
  for (const pa of a.profiles) {
    for (const pb of b.profiles) {
      const shared = sharedDuplicateClass(pa, pb);
      if (shared) return shared;
    }
  }
  return null;
}

/** How the warning names a drug the patient already takes. */
function contextTitle(ctx: ContextDrug): string {
  return ctx.source === "COURSE"
    ? `${ctx.drug.nameRu} (уже принимает)`
    : `${ctx.drug.nameRu} (со слов пациента)`;
}

function contextDetail(ctx: ContextDrug): string {
  if (ctx.source === "COURSE") {
    const since = ctx.since ? formatDate(ctx.since, "ru", "short") : "";
    return since
      ? `${ctx.drug.nameRu}: текущий курс пациента с ${since}. `
      : `${ctx.drug.nameRu}: текущий курс пациента. `;
  }
  return `${ctx.drug.nameRu}: пациент указал в анкете перед визитом, уточните. `;
}

/** A course the patient may still be on, or a medicine he listed. */
type TherapyCandidate = {
  drug: DrugPick;
  source: ContextDrug["source"];
  since: Date | null;
  /** The course, whose open end depends on its drug's class. */
  course: CourseLike | null;
};

/**
 * The patient's possible current therapy as catalog drugs: running courses
 * (linked through the visit row they mirror when there is one, else by the
 * name they were written under) and, from a recent questionnaire, the
 * medicines the patient listed. Courses first, one entry per course: an
 * open-ended course is kept here while it could still run (a year) and
 * cut to its drug's horizon by `currentOnly` once its class is known.
 */
async function loadCurrentTherapy(args: {
  clinicId: string;
  patientId: string;
  visitNoteId: string | null;
  now: Date;
  questionnaire: { medications: string[]; submittedAt: Date | null } | null;
  catalog: Catalog;
}): Promise<TherapyCandidate[]> {
  const courses = await prisma.prescription.findMany({
    where: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      status: "ACTIVE",
    },
    select: {
      drugName: true,
      schedule: true,
      status: true,
      createdAt: true,
      visitNoteId: true,
      visitNoteSortOrder: true,
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const live = courses.filter(
    (c) =>
      isCourseCurrent(c, args.now, true) &&
      !(args.visitNoteId && c.visitNoteId === args.visitNoteId),
  );

  // A course bridged from a signed visit mirrors one of its rows, and that
  // row names the catalog drug the doctor picked: more exact than its name.
  const bridged = live.filter(
    (c) => c.visitNoteId && c.visitNoteSortOrder != null,
  );
  const rows =
    bridged.length > 0
      ? await prisma.visitPrescription.findMany({
          where: {
            OR: bridged.map((c) => ({
              visitNoteId: c.visitNoteId!,
              sortOrder: c.visitNoteSortOrder!,
            })),
          },
          select: { visitNoteId: true, sortOrder: true, drugId: true },
        })
      : [];
  const drugIdOf = new Map(
    rows.map((r) => [`${r.visitNoteId}:${r.sortOrder}`, r.drugId]),
  );
  const linkedIds = [
    ...new Set(
      rows
        .map((r) => r.drugId)
        // A clinic quick-add is a bare name: resolve it by text instead.
        .filter((id): id is string => !!id && !id.startsWith("clinic-")),
    ),
  ];
  const linked =
    linkedIds.length > 0
      ? (
          await prisma.drug.findMany({
            where: { id: { in: linkedIds } },
            select: DRUG_SELECT,
          })
        ).map(pick)
      : [];
  const linkedById = new Map(linked.map((d) => [d.id, d]));

  const out: TherapyCandidate[] = [];
  for (const c of live) {
    const id = c.visitNoteId
      ? drugIdOf.get(`${c.visitNoteId}:${c.visitNoteSortOrder}`)
      : null;
    let drug = id ? linkedById.get(id) : undefined;
    if (!drug) {
      drug = matchDrugLine(await args.catalog.textIndex(), c.drugName)?.drug;
    }
    if (drug) {
      out.push({ drug, source: "COURSE", since: courseStart(c), course: c });
    }
  }

  const q = args.questionnaire;
  if (q && q.medications.length > 0 && isQuestionnaireFresh(q.submittedAt, args.now)) {
    const index = await args.catalog.textIndex();
    for (const med of q.medications) {
      const m = matchDrugLine(index, med);
      if (m) {
        out.push({
          drug: m.drug,
          source: "PATIENT_REPORTED",
          since: q.submittedAt,
          course: null,
        });
      }
    }
  }
  return out;
}

/**
 * The candidates the patient is still on, one entry per drug (courses
 * first). A course without a duration counts for a year only when its drug
 * is taken long term, read from every row it stands for (current-therapy.ts):
 * the ketorolac of a visit three months ago is not today's therapy.
 */
function currentOnly(
  candidates: readonly TherapyCandidate[],
  views: ReadonlyMap<string, CheckDrug>,
  now: Date,
): TherapyCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((t) => {
    if (seen.has(t.drug.id)) return false;
    if (t.course) {
      const rows = views.get(t.drug.id)?.profiles ?? [t.drug];
      if (!isCourseCurrent(t.course, now, isLongTermTherapy(rows))) return false;
    }
    seen.add(t.drug.id);
    return true;
  });
}

export async function runDrugCheck(input: CdsCheckInput): Promise<CdsCheckResult> {
  const { clinicId, patientId, prescriptionLines, diagnosisCode } = input;
  const now = input.now ?? new Date();
  const catalog = catalogLoader();

  const { hits: textHits, unresolved } = await resolveDrugs(
    prescriptionLines,
    catalog,
  );

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
      ? (
          await prisma.drug.findMany({
            where: { id: { in: pinnedIds } },
            select: DRUG_SELECT,
          })
        ).map(pick)
      : [];

  const seenIds = new Set<string>();
  const resolved: ResolvedDrug[] = [];
  const basketRows: DrugPick[] = [];
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
    basketRows.push(d);
  }
  for (const h of textHits) {
    noteName(h.drug.id, h.nameKey, h.label);
    if (seenIds.has(h.drug.id)) continue;
    seenIds.add(h.drug.id);
    resolved.push(toResolved(h.drug, h.lineIndex));
    basketRows.push(h.drug);
  }

  if (resolved.length === 0) {
    return {
      warnings: [],
      resolvedDrugs: [],
      unresolvedLines: unresolved,
      noInteractionData: [],
      noPregnancyData: [],
      currentTherapy: [],
    };
  }

  const [allergies, patient, preVisit, diagnoses, chronic] = await Promise.all([
    prisma.patientAllergy.findMany({
      where: { clinicId, patientId },
      select: { id: true, substance: true, severity: true, reaction: true },
    }),
    prisma.patient.findFirst({
      where: { id: patientId, clinicId },
      select: { birthDate: true, gender: true, fullName: true },
    }),
    // The newest questionnaire: its allergies count whatever its age (audit
    // G4-02), its medicines only while recent (current-therapy.ts).
    prisma.appointment.findFirst({
      where: { clinicId, patientId, preVisitSubmittedAt: { not: null } },
      orderBy: { preVisitSubmittedAt: "desc" },
      select: { preVisitData: true, preVisitSubmittedAt: true },
    }),
    prisma.patientDiagnosis.findMany({
      where: { clinicId, patientId, status: "ACTIVE" },
      select: { icd10Code: true, label: true },
      take: 100,
    }),
    prisma.patientChronicCondition.findMany({
      where: { clinicId, patientId, isActive: true },
      select: { name: true, notes: true },
      take: 100,
    }),
  ]);
  const questionnaire = parsePreVisitData(preVisit?.preVisitData);

  const candidates = await loadCurrentTherapy({
    clinicId,
    patientId,
    visitNoteId: input.visitNoteId ?? null,
    now,
    questionnaire: questionnaire
      ? {
          medications: questionnaire.medications,
          submittedAt: preVisit?.preVisitSubmittedAt ?? null,
        }
      : null,
    catalog,
  });

  const views = await substanceViews(
    dedupeById([...basketRows, ...candidates.map((t) => t.drug)]),
    catalog,
  );
  const therapy = currentOnly(candidates, views, now);
  const basket: CheckDrug[] = basketRows.map((d) => views.get(d.id)!);
  const resolvedById = new Map(resolved.map((r) => [r.id, r]));

  // Prescribing a drug the patient already takes is continuing it, not a
  // second drug: such a course is this visit's row, not a context to check
  // against (and never «one substance twice»).
  const context: ContextDrug[] = therapy
    .filter((t) => !seenIds.has(t.drug.id))
    .map((t) => ({ ...views.get(t.drug.id)!, source: t.source, since: t.since }))
    .filter((c) => !basket.some((b) => sameSubstance(b, c)));

  // The patient's conditions: the visit diagnosis, the active diagnoses on
  // the card and the chronic list (a code in the record, else its words).
  const records: PatientCondition[] = [
    ...(diagnosisCode
      ? [{ code: diagnosisCode, label: null, origin: "VISIT" as const }]
      : []),
    ...diagnoses.map((d) => ({
      code: d.icd10Code?.trim() || null,
      label: d.label,
      origin: "DIAGNOSIS" as const,
    })),
    ...chronic.map((c) => ({
      code: icdCodeIn(c.name, c.notes),
      label: c.name,
      origin: "CHRONIC" as const,
    })),
  ];
  const codes = patientCodes(records);

  const basketProfileIds = [
    ...new Set(basket.flatMap((b) => b.profiles.map((p) => p.id))),
  ];
  const allProfileIds = [
    ...new Set([
      ...basketProfileIds,
      ...context.flatMap((c) => c.profiles.map((p) => p.id)),
    ]),
  ];

  const [interactions, coveredRows] = await Promise.all([
    prisma.drugInteraction.findMany({
      where: {
        OR: [
          { drugAId: { in: allProfileIds }, drugBId: { in: allProfileIds } },
        ],
      },
      select: {
        drugAId: true,
        drugBId: true,
        severity: true,
        mechanism: true,
        advice: true,
        riskDiagnoses: true,
      },
    }),
    // Which of the basket's substances appear in ANY curated pair: a drug
    // with no pair and no class rule has no interaction data at all.
    prisma.drugInteraction.findMany({
      where: {
        OR: [
          { drugAId: { in: basketProfileIds } },
          { drugBId: { in: basketProfileIds } },
        ],
      },
      select: { drugAId: true, drugBId: true },
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
  // Allergies the patient listed in the Mini App questionnaire before the
  // visit (audit G4-02). They are not in PatientAllergy until someone
  // copies them over, and the doctor must not miss them meanwhile.
  for (const raw of questionnaire?.allergies ?? []) {
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

  const asAllergyDrug = (d: DrugPick): AllergyDrug => ({
    id: d.id,
    inn: d.inn,
    nameRu: d.nameRu,
    atcCode: d.atcCode,
    brandNames: d.brands.map((b) => b.name),
  });

  for (const allergy of allergyEntries) {
    for (const cd of basket) {
      const drug = resolvedById.get(cd.drug.id)!;
      // The drug itself first, then what it contains: the aspirin in
      // «Тромбо АСС», the diclofenac in a combination (audit G4-08).
      let match: AllergyMatch | null = null;
      for (const p of cd.profiles) {
        const m = matchAllergy(allergy.substance, asAllergyDrug(p));
        if (m?.kind === "SUBSTANCE") {
          match = m;
          break;
        }
        match ??= m;
      }
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
        drugA: ref(drug),
      });
    }
  }

  // Pairs to check: two drugs of this visit, or a drug of this visit and one
  // the patient already takes. Two drugs of the current therapy are not
  // this visit's decision and were checked when they were prescribed.
  type Pair = { x: CheckDrug; y: CheckDrug; ctx: ContextDrug | null };
  const pairs: Pair[] = [];
  for (let i = 0; i < basket.length; i += 1) {
    for (let j = i + 1; j < basket.length; j += 1) {
      pairs.push({ x: basket[i]!, y: basket[j]!, ctx: null });
    }
    for (const c of context) pairs.push({ x: basket[i]!, y: c, ctx: c });
  }
  const pairKey = (p: Pair) => [p.x.drug.id, p.y.drug.id].sort().join("|");
  const ids = (cd: CheckDrug) => new Set(cd.profiles.map((p) => p.id));

  const pairTitle = (p: Pair, aFirst: boolean) => {
    if (p.ctx) return `${p.x.drug.nameRu} + ${contextTitle(p.ctx)}`;
    const [a, b] = aFirst ? [p.x, p.y] : [p.y, p.x];
    return `${a.drug.nameRu} + ${b.drug.nameRu}`;
  };
  const pairDetail = (p: Pair, text: string) =>
    p.ctx ? `${contextDetail(p.ctx)}${text}` : text;
  const pairRefs = (p: Pair, aFirst: boolean) => {
    const [a, b] = p.ctx || aFirst ? [p.x, p.y] : [p.y, p.x];
    return { drugA: ref(a.drug), drugB: ref(b.drug) };
  };

  // ── Interactions (curated pairs) ─────────────────────────────────────
  // Keyed on catalog ids, now on the ids of every substance a drug stands
  // for, so a register twin or a combination meets the curated pair of its
  // substance (audit G4-08). One warning per pair: the most severe row.
  const curatedPairs = new Set<string>();
  const flaggedPairs = new Set<string>();
  for (const p of pairs) {
    const xs = ids(p.x);
    const ys = ids(p.y);
    let best: { row: (typeof interactions)[number]; aFirst: boolean } | null = null;
    for (const row of interactions) {
      const forward = xs.has(row.drugAId) && ys.has(row.drugBId);
      const backward = ys.has(row.drugAId) && xs.has(row.drugBId);
      if (!forward && !backward) continue;
      if (!best || SEVERITY_RANK[row.severity] > SEVERITY_RANK[best.row.severity]) {
        best = { row, aFirst: forward };
      }
    }
    if (!best) continue;
    const { row, aFirst } = best;
    const riskCode = codes.find((c) =>
      row.riskDiagnoses.some((r) => c.startsWith(r.toUpperCase())),
    );
    const text = row.mechanism ? `${row.mechanism}. ${row.advice}` : row.advice;
    warnings.push({
      kind: riskCode ? "DIAGNOSIS_RISK" : "INTERACTION",
      severity: row.severity,
      title: riskCode
        ? `Риск при ${riskCode}: ${pairTitle(p, aFirst)}`
        : pairTitle(p, aFirst),
      detail: pairDetail(p, text),
      ...pairRefs(p, aFirst),
    });
    curatedPairs.add(pairKey(p));
    flaggedPairs.add(pairKey(p));
  }

  // ── Interactions (class rules) ───────────────────────────────────────
  // A curated pair is more specific than a class rule, so it wins for the
  // same two drugs.
  for (const p of pairs) {
    if (curatedPairs.has(pairKey(p))) continue;
    for (const hit of rulesBetween(p.x.profiles, p.y.profiles)) {
      flaggedPairs.add(pairKey(p));
      warnings.push({
        kind: "INTERACTION",
        severity: hit.rule.severity,
        title: pairTitle(p, hit.xIsA),
        detail: pairDetail(p, `${hit.rule.mechanism}. ${hit.rule.advice}`),
        ...pairRefs(p, hit.xIsA),
      });
    }
  }

  // ── Interaction coverage ─────────────────────────────────────────────
  const curatedIds = new Set(
    coveredRows.flatMap((r) => [r.drugAId, r.drugBId]),
  );
  const noInteractionData = basket
    .filter(
      (cd) =>
        !cd.profiles.some((p) => curatedIds.has(p.id) || isCoveredByRules(p)),
    )
    .map((cd) => cd.drug.id);

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
      drugA: ref(drug),
    });
  }
  // Two catalog rows with one substance: the register's twin of a curated
  // row, a combination next to its own component, or a register row with no
  // ATC code next to the curated row of its name.
  const substancePairs = new Set<string>();
  for (const p of pairs) {
    if (p.ctx || !sameSubstance(p.x, p.y)) continue;
    substancePairs.add(pairKey(p));
    warnings.push({
      kind: "DUPLICATE_CLASS",
      severity: "MAJOR",
      title: `Одно вещество дважды: ${p.x.drug.nameRu} и ${p.y.drug.nameRu}`,
      detail: "Препараты содержат одно и то же действующее вещество. Проверьте, не удваивается ли доза.",
      drugA: ref(p.x.drug),
      drugB: ref(p.y.drug),
    });
  }

  // ── Duplicate class ──────────────────────────────────────────────────
  // Skip pairs already flagged via a curated pair, a class rule or a shared
  // substance. A class shared with the current therapy counts too: a new
  // NSAID on top of the one the patient already takes.
  for (const p of pairs) {
    const key = pairKey(p);
    if (flaggedPairs.has(key) || substancePairs.has(key)) continue;
    const shared = sharedClass(p.x, p.y);
    if (!shared) continue;
    warnings.push({
      kind: "DUPLICATE_CLASS",
      severity: "MODERATE",
      title: p.ctx ? `${shared.title}, ${pairTitle(p, true)}` : shared.title,
      detail: pairDetail(
        p,
        "Препараты относятся к одному классу. Проверьте необходимость дублирования.",
      ),
      drugA: ref(p.x.drug),
      drugB: ref(p.y.drug),
    });
  }

  // ── Pregnancy ────────────────────────────────────────────────────────
  // One warning per drug of category D/X, for any patient who may be
  // pregnant. The catalog's own category wins; a drug the catalog left
  // UNKNOWN takes the strictest category of its substances (their curated
  // value, or their class's when the catalog is silent).
  const pregnancy = pregnancyContext(patient);
  const categoryOf = (cd: CheckDrug) =>
    cd.drug.pregnancyCat !== "UNKNOWN"
      ? cd.drug.pregnancyCat
      : strictestCategory(cd.profiles.map((p) => effectivePregnancyCat(p)));
  for (const cd of basket) {
    const drug = resolvedById.get(cd.drug.id)!;
    const w = pregnancyWarning({ ...drug, pregnancyCat: categoryOf(cd) }, pregnancy);
    if (w) warnings.push(w);
  }
  const noPregnancyData =
    pregnancy === "NONE"
      ? []
      : basket.filter((cd) => categoryOf(cd) === "UNKNOWN").map((cd) => cd.drug.id);

  // ── Contraindications ────────────────────────────────────────────────
  // The drug's own catalog lines (or, for a register row or a combination,
  // those of its substances) against the patient's diagnoses (audit G4-03).
  for (const cd of basket) {
    const lines = contraindicationLines(cd.drug, cd.profiles.slice(1));
    for (const hit of findContraindicationHits(lines, records)) {
      // «при G40.9» reads well; a record named only in words gets the
      // condition's name instead of a declined form of it.
      const lead = hit.qualified ? "Осторожно" : "Противопоказан";
      const title = hit.record.code
        ? `${lead} при ${hit.record.code}: ${cd.drug.nameRu}`
        : `${lead}, ${hit.condition.labelRu}: ${cd.drug.nameRu}`;
      warnings.push({
        kind: "DIAGNOSIS_RISK",
        severity: hit.severity,
        title,
        detail:
          `В противопоказаниях препарата: «${hit.line}». У пациента: ${describeRecord(hit.record)}. ` +
          (hit.qualified
            ? "Противопоказание касается только состояния из этой строки, уточните, относится ли оно к пациенту."
            : "Выберите другой препарат или обоснуйте назначение."),
        drugA: ref(cd.drug),
      });
    }
  }

  warnings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return {
    warnings,
    resolvedDrugs: resolved,
    unresolvedLines: unresolved,
    noInteractionData,
    noPregnancyData,
    currentTherapy: context.map((c) => ({
      ...ref(c.drug),
      source: c.source,
      since: c.since ? c.since.toISOString() : null,
    })),
  };
}
