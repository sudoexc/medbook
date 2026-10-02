/**
 * A prisma stand-in for the CDS engine tests: the real curated catalog
 * (prisma/_drug-catalog.ts merged with _drug-data.ts, as seed-drugs.ts
 * writes it), the real curated interaction pairs, plus the register rows and
 * patient records a test puts into `cdsState`. Queries are answered by what
 * their `where` asks, so the engine's reads are exercised, not bypassed.
 */
import { vi } from "vitest";

import { DRUGS } from "../../prisma/_drug-catalog";
import { DRUG_ENRICHMENT } from "../../prisma/_drug-data";
import { DRUG_INTERACTIONS } from "../../prisma/_drug-interactions-data";

export type FixtureDrug = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  pregnancyCat: "A" | "B" | "C" | "D" | "X" | "UNKNOWN";
  contraindications: string[];
  brands: { name: string }[];
  /** Null or absent: the global catalog; set: one clinic's own drug. */
  clinicId?: string | null;
};

export const CURATED: FixtureDrug[] = DRUGS.map((d) => {
  const e = DRUG_ENRICHMENT[d.id] ?? {};
  return {
    id: d.id,
    inn: d.intl ?? d.id,
    nameRu: d.nameRu,
    atcCode: e.atcCode ?? null,
    pregnancyCat: e.pregnancyCat ?? "UNKNOWN",
    contraindications: e.contraindications ?? [],
    brands: (d.brands ?? []).map((name) => ({ name })),
  };
});

/** A state-register row as the import writes it: no clinical data. */
export function registerRow(
  id: string,
  nameRu: string,
  atcCode: string | null,
  brands: string[] = [],
): FixtureDrug {
  return {
    id,
    inn: `uzr:${id}`,
    nameRu,
    atcCode,
    pregnancyCat: "UNKNOWN",
    contraindications: [],
    brands: brands.map((name) => ({ name })),
  };
}

const PAIRS = DRUG_INTERACTIONS.map((p) => ({
  drugAId: p.a,
  drugBId: p.b,
  severity: p.severity,
  mechanism: p.mechanism ?? null,
  advice: p.advice,
  riskDiagnoses: p.riskDiagnoses ?? [],
}));

export type FixtureCourse = {
  drugName: string;
  schedule: unknown;
  status: string;
  createdAt: Date;
  visitNoteId: string | null;
  visitNoteSortOrder: number | null;
};

export const cdsState = {
  register: [] as FixtureDrug[],
  allergies: [] as Array<{
    id: string;
    substance: string;
    severity: string | null;
    reaction: string | null;
  }>,
  patient: { birthDate: null, gender: "MALE", fullName: "Каримов Азиз" } as {
    birthDate: Date | null;
    gender: "MALE" | "FEMALE" | null;
    fullName: string;
  },
  preVisit: null as null | { preVisitData: unknown; preVisitSubmittedAt: Date },
  courses: [] as FixtureCourse[],
  visitRows: [] as Array<{ visitNoteId: string; sortOrder: number; drugId: string | null }>,
  diagnoses: [] as Array<{ icd10Code: string | null; label: string }>,
  chronic: [] as Array<{ name: string; notes: string | null }>,
};

export function resetCdsState(): void {
  cdsState.register = [];
  cdsState.allergies = [];
  cdsState.patient = { birthDate: null, gender: "MALE", fullName: "Каримов Азиз" };
  cdsState.preVisit = null;
  cdsState.courses = [];
  cdsState.visitRows = [];
  cdsState.diagnoses = [];
  cdsState.chronic = [];
}

type In = { in?: string[] };
type DrugWhere = {
  id?: In;
  atcCode?: In;
  NOT?: { inn?: { startsWith?: string } };
  OR?: Array<{ clinicId?: string | null }>;
};
type PairWhere = { OR: Array<{ drugAId?: In; drugBId?: In }> };

export function makeCdsPrisma() {
  const all = () => [...CURATED, ...cdsState.register];
  return {
    drug: {
      findMany: vi.fn(async ({ where = {} }: { where?: DrugWhere }) =>
        all().filter(
          (d) =>
            (!where.id?.in || where.id.in.includes(d.id)) &&
            (!where.atcCode?.in ||
              (!!d.atcCode && where.atcCode.in.includes(d.atcCode))) &&
            !(
              where.NOT?.inn?.startsWith &&
              d.inn.startsWith(where.NOT.inn.startsWith)
            ) &&
            (!where.OR ||
              where.OR.some(
                (c) => "clinicId" in c && c.clinicId === (d.clinicId ?? null),
              )),
        ),
      ),
    },
    drugInteraction: {
      findMany: vi.fn(async ({ where }: { where: PairWhere }) =>
        PAIRS.filter((p) =>
          where.OR.some(
            (c) =>
              (!c.drugAId?.in || c.drugAId.in.includes(p.drugAId)) &&
              (!c.drugBId?.in || c.drugBId.in.includes(p.drugBId)),
          ),
        ),
      ),
    },
    patientAllergy: { findMany: vi.fn(async () => cdsState.allergies) },
    patient: { findFirst: vi.fn(async () => cdsState.patient) },
    appointment: { findFirst: vi.fn(async () => cdsState.preVisit) },
    prescription: {
      findMany: vi.fn(async ({ where }: { where: { status?: string } }) =>
        cdsState.courses.filter((c) => !where.status || c.status === where.status),
      ),
    },
    visitPrescription: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { OR: Array<{ visitNoteId: string; sortOrder: number }> };
        }) =>
          cdsState.visitRows.filter((r) =>
            where.OR.some(
              (c) => c.visitNoteId === r.visitNoteId && c.sortOrder === r.sortOrder,
            ),
          ),
      ),
    },
    patientDiagnosis: { findMany: vi.fn(async () => cdsState.diagnoses) },
    patientChronicCondition: { findMany: vi.fn(async () => cdsState.chronic) },
  };
}

export const NOW = new Date("2026-09-28T09:00:00Z");
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

export async function check(
  ids: string[],
  opts: { diagnosisCode?: string | null; lines?: string[]; visitNoteId?: string } = {},
) {
  const { runDrugCheck } = await import("@/server/cds/drug-check");
  return runDrugCheck({
    clinicId: "c1",
    patientId: "p1",
    prescriptionLines: opts.lines ?? [],
    drugIds: ids,
    diagnosisCode: opts.diagnosisCode ?? null,
    visitNoteId: opts.visitNoteId ?? null,
    now: NOW,
  });
}
