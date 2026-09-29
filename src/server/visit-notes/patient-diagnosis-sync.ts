/**
 * Audit VW-10 — keep the patient's diagnoses in step with the signed
 * conclusion.
 *
 * Signing a note puts its diagnosis on the patient's card (PatientDiagnosis,
 * ACTIVE). That happened only at finalize and only for the new diagnosis: a
 * diagnosis corrected inside the 24h window (G43.0 → G44.2 on the conclusion
 * screen) left G43.0 ACTIVE and never added G44.2, and a re-signature after
 * a revert with another code left both ACTIVE. Other doctors and the desk
 * read that card, and the doctor's drug check reads it too.
 *
 * Every row created here remembers its note (`sourceVisitNoteId`). At each
 * signature and each in-window correction the note's rows follow its current
 * diagnosis:
 *   - the current diagnosis is on the card and ACTIVE: an existing row of
 *     the same diagnosis is re-activated (as before), else a row this note
 *     created for its previous diagnosis moves to the new one, else a new
 *     row is created;
 *   - a row this note created for a diagnosis it no longer carries is
 *     resolved, unless another signed note of the patient still carries
 *     that diagnosis. Resolved, never deleted: the card keeps the trace with
 *     a line saying why, and the note's revisions keep what was signed.
 * Rows the note did not create (typed in the card, or created by another
 * visit and only re-activated here) are never moved or resolved.
 *
 * A note carries its main diagnosis and up to three more (29.09.2026); each
 * of them is followed onto the card the same way, and «another signed note
 * carries it» counts the other notes' additional diagnoses too.
 */
import type { prisma as prismaT } from "@/lib/prisma";
import type { TenantContext } from "@/lib/tenant-context";
import { visitDiagnosisKey, type VisitDiagnosis } from "@/lib/visit-diagnoses";
import { publishMedicalRecordChanged } from "@/server/patient/medical-record-events";
import type { OutboxTx } from "@/server/realtime/outbox";

type TenantCtx = Extract<TenantContext, { kind: "TENANT" }>;

type DiagnosisRow = {
  id: string;
  icd10Code: string | null;
  label: string;
  status: string;
  notes: string | null;
};

type Target = { code: string | null; name: string | null };

/** Code when there is one; the label names an uncoded diagnosis. */
function sameDiagnosis(
  row: Pick<DiagnosisRow, "icd10Code" | "label">,
  code: string | null,
  name: string | null,
): boolean {
  return code
    ? row.icd10Code === code
    : !row.icd10Code && !!name && row.label.trim() === name;
}

function withLine(notes: string | null, line: string): string {
  return notes?.trim() ? `${notes.trim()}\n${line}` : line;
}

/**
 * The note's diagnoses to put on the card, main first, each once. Since
 * 29.09.2026 a visit has up to three more after the main one, and each is a
 * diagnosis of the patient like the main one.
 */
function targetsOf(args: {
  diagnosisCode: string | null;
  diagnosisName: string | null;
  additionalDiagnoses?: readonly VisitDiagnosis[] | null;
}): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  const push = (rawCode: string | null, rawName: string | null) => {
    const code = rawCode?.trim() || null;
    const name = rawName?.trim() || null;
    const key = visitDiagnosisKey({ code, name });
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ code, name });
  };
  push(args.diagnosisCode, args.diagnosisName);
  for (const d of args.additionalDiagnoses ?? []) push(d.code, d.name);
  return out;
}

export async function syncPatientDiagnosisWithNote(
  tx: OutboxTx,
  args: {
    clinicId: string;
    patientId: string;
    visitNoteId: string;
    /** The note's main diagnosis as it is now signed. */
    diagnosisCode: string | null;
    diagnosisName: string | null;
    /** The note's other diagnoses as now signed, in order. */
    additionalDiagnoses?: readonly VisitDiagnosis[] | null;
    now: Date;
    /**
     * Whether the note can own rows already: it was signed before (a
     * correction, or a re-signature after a revert). A first signature
     * cannot, which spares the read.
     */
    signedBefore: boolean;
    ctx: TenantCtx | null;
  },
): Promise<{ patientDiagnosisId: string | null; patientDiagnosisIds: string[] }> {
  // Same widening as the outbox: the tx callback arg and the client differ
  // only in what Prisma strips from transactions.
  const db = tx as typeof prismaT;
  const targets = targetsOf(args);
  const { patientId, visitNoteId } = args;
  const isTarget = (row: DiagnosisRow) =>
    targets.some((t) => sameDiagnosis(row, t.code, t.name));

  const owned: DiagnosisRow[] = args.signedBefore
    ? await db.patientDiagnosis.findMany({
        where: { patientId, sourceVisitNoteId: visitNoteId },
        select: { id: true, icd10Code: true, label: true, status: true, notes: true },
      })
    : [];

  // Does another signed note of this patient carry the diagnosis, as its
  // main one or as one of the others? Then the row stands on that visit too
  // and must stay as it is.
  const heldElsewhere = async (row: DiagnosisRow): Promise<boolean> =>
    (await db.visitNote.count({
      where: {
        patientId,
        status: "FINALIZED",
        id: { not: visitNoteId },
        OR: row.icd10Code
          ? [
              { diagnosisCode: row.icd10Code },
              {
                additionalDiagnoses: {
                  array_contains: [{ code: row.icd10Code }],
                },
              },
            ]
          : [
              { diagnosisCode: null, diagnosisName: row.label },
              {
                additionalDiagnoses: {
                  array_contains: [{ code: null, name: row.label }],
                },
              },
            ],
      },
    })) > 0;

  // Rows now standing for one of the note's diagnoses, in the note's order.
  const currentIds: string[] = [];
  const claimed = new Set<string>();
  let created = false;
  let updated = false;

  for (const { code, name } of targets) {
    // Match on the code when there is one; fall back to the label for
    // free-text diagnoses. Matching a null code would collapse every uncoded
    // diagnosis a patient ever had into one row.
    const existing = await db.patientDiagnosis.findFirst({
      where: code
        ? { patientId, icd10Code: code }
        : { patientId, icd10Code: null, label: name! },
      select: { id: true },
    });
    if (existing) {
      // diagnosedAt of an existing row stays: the first diagnosis date is
      // worth more than the latest.
      await db.patientDiagnosis.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", ...(name ? { label: name } : {}) },
        select: { id: true },
      });
      currentIds.push(existing.id);
      claimed.add(existing.id);
      updated = true;
      continue;
    }
    // A row this note created for a diagnosis it no longer carries: move it
    // instead of leaving it behind («переносить»). Never one that stands for
    // another of the note's diagnoses, and never one already moved here.
    let movable: DiagnosisRow | null = null;
    for (const row of owned) {
      if (claimed.has(row.id) || isTarget(row)) continue;
      if (!(await heldElsewhere(row))) {
        movable = row;
        break;
      }
    }
    if (movable) {
      await db.patientDiagnosis.update({
        where: { id: movable.id },
        data: {
          icd10Code: code,
          label: name || code || "",
          status: "ACTIVE",
          notes: withLine(
            movable.notes,
            `Исправлено в заключении: было ${movable.icd10Code ?? movable.label}.`,
          ),
        },
        select: { id: true },
      });
      currentIds.push(movable.id);
      claimed.add(movable.id);
      updated = true;
    } else {
      const row = await db.patientDiagnosis.create({
        data: {
          clinicId: args.clinicId,
          patientId,
          icd10Code: code,
          label: name || code || "",
          diagnosedAt: args.now,
          status: "ACTIVE",
          sourceVisitNoteId: visitNoteId,
        },
        select: { id: true },
      });
      currentIds.push(row.id);
      claimed.add(row.id);
      created = true;
    }
  }

  // The rest of what this note created and no longer says. With a single
  // diagnosis the line names what replaced it, as it always did; among
  // several there is no telling which one replaced it, so it says removed.
  const single = targets.length === 1 ? targets[0]! : null;
  let resolvedAny = false;
  for (const row of owned) {
    if (claimed.has(row.id) || row.status !== "ACTIVE") continue;
    if (isTarget(row)) continue;
    if (await heldElsewhere(row)) continue;
    await db.patientDiagnosis.update({
      where: { id: row.id },
      data: {
        status: "RESOLVED",
        notes: withLine(
          row.notes,
          single
            ? `Снят: в заключении исправлен на ${single.code ?? single.name}.`
            : "Снят: диагноз убран из заключения.",
        ),
      },
      select: { id: true },
    });
    resolvedAny = true;
  }

  const patientDiagnosisId = currentIds[0] ?? null;
  if (created || updated || resolvedAny) {
    // The patient card and the doctor's drug check read these rows (G3-02).
    await publishMedicalRecordChanged(tx, {
      ctx: args.ctx,
      clinicId: args.clinicId,
      payload: {
        patientId,
        record: "diagnosis",
        action: created ? "created" : "updated",
        ...(patientDiagnosisId ? { entityId: patientDiagnosisId } : {}),
      },
    });
  }

  return { patientDiagnosisId, patientDiagnosisIds: currentIds };
}
