/**
 * Immutable versions of a signed conclusion (audit G1-01).
 *
 * Inside the 24h window a signed conclusion can be corrected destructively:
 * the PATCH overwrote the fields in place and the handout worker overwrote
 * the PDF under the same key, so when a dispute came (a complaint, an
 * insurer, a court) the clinic could not show what had been signed, and the
 * QR on the patient's paper resolved to different text. The audit log only
 * said which fields were touched.
 *
 * Now every state of a signed note is a row here, never updated after it is
 * written (save for linking the PDF rendered from it):
 *
 *   SIGNED    the content at a signature (first sign, and a re-sign after
 *             the visit was reopened);
 *   EDITED    the content after an in-window correction, with the fields
 *             that changed and who changed them;
 *   PRE_EDIT  the content just before a correction, written only when no
 *             earlier row already holds it (notes signed before this
 *             existed, or edited while reopened).
 *
 * Consecutive rows give «before» and «after» of every correction. The PDF of
 * each render gets its own storage key and the revision it was rendered
 * from points at it, so the originally issued file is never overwritten.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/prisma";

export const REVISION_KINDS = ["SIGNED", "EDITED", "PRE_EDIT"] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

export type RevisionPrescription = {
  drugId: string | null;
  displayName: string;
  form: string | null;
  strength: string | null;
  dose: string;
  timesOfDay: string[];
  mealRelation: string;
  durationDays: number | null;
  instructionRu: string | null;
  instructionUz: string | null;
  remindPatient: boolean;
};

/** Everything a signed conclusion says, clinical and patient-facing. */
export type RevisionContent = {
  documentNumber: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  complaints: string[];
  anamnesis: string[];
  examination: string[];
  prescriptions: string[];
  visitPrescriptions: RevisionPrescription[];
  advice: string[];
  followUpDays: number | null;
  followUpNote: string | null;
  dynamics: string | null;
  dynamicsNote: string | null;
  bodyMap: unknown;
  bodyMarkdown: string | null;
  patientHandoutMarkdown: string | null;
};

type NoteLike = {
  documentNumber?: string | null;
  diagnosisCode?: string | null;
  diagnosisName?: string | null;
  complaints?: string[] | null;
  anamnesis?: string[] | null;
  examination?: string[] | null;
  prescriptions?: string[] | null;
  advice?: string[] | null;
  followUpDays?: number | null;
  followUpNote?: string | null;
  dynamics?: string | null;
  dynamicsNote?: string | null;
  bodyMap?: unknown;
  bodyMarkdown?: string | null;
  patientHandoutMarkdown?: string | null;
};

type RowLike = Partial<RevisionPrescription> & {
  displayName: string;
  dose: string;
  sortOrder?: number;
};

/** The note (+ its prescription rows, in order) as revision content. */
export function revisionContentOf(
  note: NoteLike,
  rows: readonly RowLike[],
): RevisionContent {
  const ordered = [...rows].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  return {
    documentNumber: note.documentNumber ?? null,
    diagnosisCode: note.diagnosisCode ?? null,
    diagnosisName: note.diagnosisName ?? null,
    complaints: [...(note.complaints ?? [])],
    anamnesis: [...(note.anamnesis ?? [])],
    examination: [...(note.examination ?? [])],
    prescriptions: [...(note.prescriptions ?? [])],
    visitPrescriptions: ordered.map((r) => ({
      drugId: r.drugId ?? null,
      displayName: r.displayName,
      form: r.form ?? null,
      strength: r.strength ?? null,
      dose: r.dose,
      timesOfDay: [...(r.timesOfDay ?? [])],
      mealRelation: r.mealRelation ?? "NO_MATTER",
      durationDays: r.durationDays ?? null,
      instructionRu: r.instructionRu ?? null,
      instructionUz: r.instructionUz ?? null,
      remindPatient: r.remindPatient ?? true,
    })),
    advice: [...(note.advice ?? [])],
    followUpDays: note.followUpDays ?? null,
    followUpNote: note.followUpNote ?? null,
    dynamics: note.dynamics ?? null,
    dynamicsNote: note.dynamicsNote ?? null,
    bodyMap: note.bodyMap ?? null,
    bodyMarkdown: note.bodyMarkdown ?? null,
    patientHandoutMarkdown: note.patientHandoutMarkdown ?? null,
  };
}

/** JSON with sorted keys: jsonb hands objects back in its own key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Top-level fields whose value differs between two revisions. */
export function changedRevisionFields(
  a: RevisionContent | Record<string, unknown>,
  b: RevisionContent | Record<string, unknown>,
): string[] {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys]
    .filter((k) => canonical(left[k]) !== canonical(right[k]))
    .sort();
}

export function sameRevisionContent(
  a: RevisionContent | Record<string, unknown>,
  b: RevisionContent | Record<string, unknown>,
): boolean {
  return changedRevisionFields(a, b).length === 0;
}

/** The interactive-transaction client of our extended `prisma`. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type LatestRevision = {
  id: string;
  revision: number;
  content: unknown;
};

export async function latestRevision(
  tx: Tx,
  visitNoteId: string,
): Promise<LatestRevision | null> {
  return tx.visitNoteRevision.findFirst({
    where: { visitNoteId },
    orderBy: { revision: "desc" },
    select: { id: true, revision: true, content: true },
  });
}

/**
 * Append one revision. Call it after the transaction has updated the
 * VisitNote row: that UPDATE holds the row lock until commit, so two
 * concurrent writers of the same note number their revisions one after
 * the other instead of colliding on (visitNoteId, revision).
 */
export async function appendRevision(
  tx: Tx,
  input: {
    clinicId: string;
    visitNoteId: string;
    revision: number;
    kind: RevisionKind;
    content: RevisionContent;
    changedFields?: string[];
    authorUserId?: string | null;
    authorName?: string | null;
    pdfObjectKey?: string | null;
    createdAt?: Date;
  },
): Promise<{ id: string; revision: number }> {
  return tx.visitNoteRevision.create({
    data: {
      clinicId: input.clinicId,
      visitNoteId: input.visitNoteId,
      revision: input.revision,
      kind: input.kind,
      content: input.content as unknown as Prisma.InputJsonValue,
      changedFields: input.changedFields ?? [],
      authorUserId: input.authorUserId ?? null,
      authorName: input.authorName ?? null,
      pdfObjectKey: input.pdfObjectKey ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true, revision: true },
  });
}

/**
 * Record an in-window correction of a signed note: make sure the state it
 * overwrites is on record (PRE_EDIT when no revision holds it yet), then
 * the new state (EDITED) when anything actually changed. Returns the
 * revision numbers for the audit entry.
 */
export async function recordSignedEdit(
  tx: Tx,
  input: {
    clinicId: string;
    visitNoteId: string;
    before: RevisionContent;
    after: RevisionContent;
    authorUserId: string | null;
    authorName: string | null;
    /** Storage key of the PDF issued before this edit, for a PRE_EDIT row. */
    issuedPdfKey?: () => Promise<string | null>;
  },
): Promise<{ before: number; after: number } | null> {
  const changed = changedRevisionFields(input.before, input.after);
  if (changed.length === 0) return null;

  let latest = await latestRevision(tx, input.visitNoteId);
  if (
    !latest ||
    !sameRevisionContent(
      latest.content as Record<string, unknown>,
      input.before,
    )
  ) {
    const created = await appendRevision(tx, {
      clinicId: input.clinicId,
      visitNoteId: input.visitNoteId,
      revision: (latest?.revision ?? 0) + 1,
      kind: "PRE_EDIT",
      content: input.before,
      // Only the very first row can claim the PDF already issued: later
      // PDFs are linked to their own revisions by the render worker.
      pdfObjectKey: latest ? null : ((await input.issuedPdfKey?.()) ?? null),
    });
    latest = { ...created, content: input.before };
  }
  const edited = await appendRevision(tx, {
    clinicId: input.clinicId,
    visitNoteId: input.visitNoteId,
    revision: latest.revision + 1,
    kind: "EDITED",
    content: input.after,
    changedFields: changed,
    authorUserId: input.authorUserId,
    authorName: input.authorName,
  });
  return { before: latest.revision, after: edited.revision };
}

/**
 * Keep the signed state of a note on record before it is first overwritten,
 * when no revision holds it yet: a note signed before revisions existed, or
 * reopened by a visit revert and about to be edited as a draft, or re-signed
 * with a recomposed handout. Once a revision exists it already carries the
 * last signed state (every signature and in-window edit writes one).
 */
export async function ensureSignedStateOnRecord(
  tx: Tx,
  input: {
    clinicId: string;
    visitNoteId: string;
    content: RevisionContent;
    issuedPdfKey?: () => Promise<string | null>;
  },
): Promise<LatestRevision | null> {
  const latest = await latestRevision(tx, input.visitNoteId);
  if (latest) return latest;
  const created = await appendRevision(tx, {
    clinicId: input.clinicId,
    visitNoteId: input.visitNoteId,
    revision: 1,
    kind: "PRE_EDIT",
    content: input.content,
    pdfObjectKey: (await input.issuedPdfKey?.()) ?? null,
  });
  return { ...created, content: input.content };
}
