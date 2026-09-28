/**
 * The doctor's clinical note on a patient card (audit PT-11).
 *
 * «Медицина → Заметки» used to save into `Patient.notes`, the very field the
 * front desk edits as «Заметки» on the card overview: reception typing
 * «просит перезвонить после 18:00» replaced the treatment plan, and every
 * role, the call center included, read it. The clinical note now lives in
 * its own row (`PatientClinicalNote`), encrypted like `Patient.notes`,
 * served only by /api/crm/patients/[id]/clinical-note to clinical roles,
 * with who last saved it and when. `Patient.notes` stays the staff note.
 */
import type { prisma } from "@/lib/prisma";
import {
  decryptField,
  encryptField,
  isEncryptedField,
} from "@/server/crypto/field-cipher";

type Db = Pick<typeof prisma, "patientClinicalNote" | "user">;

/** Roles that read and write the clinical note. */
export const CLINICAL_NOTE_ROLES = ["ADMIN", "DOCTOR", "NURSE"] as const;

export type ClinicalNote = {
  text: string;
  updatedAt: string | null;
  updatedBy: { id: string; name: string | null } | null;
};

const EMPTY: ClinicalNote = { text: "", updatedAt: null, updatedBy: null };

/** The stored body as text (legacy plaintext passes through). */
export function readClinicalNoteBody(body: string): string {
  return isEncryptedField(body) ? (decryptField(body) ?? "") : body;
}

async function authorOf(
  db: Db,
  userId: string | null,
): Promise<ClinicalNote["updatedBy"]> {
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
  // A departed account still says the note was someone's, not nobody's.
  return user ?? { id: userId, name: null };
}

export async function readClinicalNote(
  db: Db,
  patientId: string,
): Promise<ClinicalNote> {
  const row = await db.patientClinicalNote.findUnique({
    where: { patientId },
    select: { body: true, updatedAt: true, updatedById: true },
  });
  if (!row) return EMPTY;
  return {
    text: readClinicalNoteBody(row.body),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: await authorOf(db, row.updatedById),
  };
}

/**
 * Save the note; an empty text removes it. Returns what the card shows next.
 */
export async function saveClinicalNote(
  db: Db,
  input: { clinicId: string; patientId: string; text: string; userId: string | null },
): Promise<ClinicalNote> {
  const text = input.text.trim();
  if (text === "") {
    await db.patientClinicalNote.deleteMany({
      where: { patientId: input.patientId },
    });
    return EMPTY;
  }
  const body = encryptField(text);
  const row = await db.patientClinicalNote.upsert({
    where: { patientId: input.patientId },
    create: {
      clinicId: input.clinicId,
      patientId: input.patientId,
      body,
      updatedById: input.userId,
    },
    update: { body, updatedById: input.userId },
    select: { updatedAt: true, updatedById: true },
  });
  return {
    text,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: await authorOf(db, row.updatedById),
  };
}
