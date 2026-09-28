/**
 * Everything a patient card carries besides its own row (audit G1-09).
 *
 * DELETE /api/crm/patients/[id] used to count five tables (visits, visit
 * notes, documents, payments, cases). Everything else either cascaded
 * away with the card (allergies, diagnoses, courses of medication, DSAR
 * requests) or held a restricting foreign key (a broadcast that reached the
 * patient, a lab result), and the delete then failed with a raw 500. Now
 * every relation of `Patient` is counted in one query, so the only card
 * that can be deleted is a truly empty one created by mistake.
 *
 * The relation list lives in `src/lib/patients/footprint-groups.ts` and a
 * unit test pins it against prisma/schema.prisma.
 */
import type { prisma } from "@/lib/prisma";
import {
  FOOTPRINT_RELATIONS,
  type FootprintRelation,
} from "@/lib/patients/footprint-groups";

type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type PatientFootprint = Record<FootprintRelation, number>;

/** `_count` select for every list relation (the clinical note is 1:1). */
function countSelect(): Record<string, true> {
  const select: Record<string, true> = {};
  for (const rel of FOOTPRINT_RELATIONS) {
    if (rel !== "clinicalNote") select[rel] = true;
  }
  return select;
}

/**
 * Counts per relation, or null when the card does not exist (in this
 * clinic: the tenant scope applies).
 */
export async function patientFootprint(
  db: Db,
  patientId: string,
): Promise<PatientFootprint | null> {
  const row = (await db.patient.findUnique({
    where: { id: patientId },
    select: { _count: { select: countSelect() } },
  } as never)) as { _count: Record<string, number> } | null;
  if (!row) return null;
  const clinicalNote = await db.patientClinicalNote.count({
    where: { patientId },
  });
  const out = {} as PatientFootprint;
  for (const rel of FOOTPRINT_RELATIONS) {
    out[rel] = rel === "clinicalNote" ? clinicalNote : (row._count[rel] ?? 0);
  }
  return out;
}

/** Only the relations with something in them: the 409 payload. */
export function footprintFound(
  footprint: PatientFootprint,
): Partial<PatientFootprint> {
  const found: Partial<PatientFootprint> = {};
  for (const rel of FOOTPRINT_RELATIONS) {
    if (footprint[rel] > 0) found[rel] = footprint[rel];
  }
  return found;
}

/**
 * Take the card's row lock for the rest of the transaction. A booking or an
 * allergy inserted meanwhile needs a key-share lock on this row for its
 * foreign key, so it waits until the delete commits (and then fails on the
 * missing card) instead of slipping in between the count and the delete.
 */
export async function lockPatientRow(db: Db, patientId: string): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${patientId} FOR UPDATE`;
}

/** Postgres refused the delete because a row still points at the card. */
export function isForeignKeyViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  if (code === "P2003" || code === "23503") return true;
  const msg = (e as { message?: unknown }).message;
  return typeof msg === "string" && /foreign key constraint/i.test(msg);
}
