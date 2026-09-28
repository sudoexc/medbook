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
 */
import type { prisma as prismaT } from "@/lib/prisma";
import type { TenantContext } from "@/lib/tenant-context";
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

export async function syncPatientDiagnosisWithNote(
  tx: OutboxTx,
  args: {
    clinicId: string;
    patientId: string;
    visitNoteId: string;
    /** The note's diagnosis as it is now signed. */
    diagnosisCode: string | null;
    diagnosisName: string | null;
    now: Date;
    /**
     * Whether the note can own rows already: it was signed before (a
     * correction, or a re-signature after a revert). A first signature
     * cannot, which spares the read.
     */
    signedBefore: boolean;
    ctx: TenantCtx | null;
  },
): Promise<{ patientDiagnosisId: string | null }> {
  // Same widening as the outbox: the tx callback arg and the client differ
  // only in what Prisma strips from transactions.
  const db = tx as typeof prismaT;
  const code = args.diagnosisCode?.trim() || null;
  const name = args.diagnosisName?.trim() || null;
  const { patientId, visitNoteId } = args;

  const owned: DiagnosisRow[] = args.signedBefore
    ? await db.patientDiagnosis.findMany({
        where: { patientId, sourceVisitNoteId: visitNoteId },
        select: { id: true, icd10Code: true, label: true, status: true, notes: true },
      })
    : [];

  // Does another signed note of this patient carry the diagnosis? Then the
  // row stands on that visit too and must stay as it is.
  const heldElsewhere = async (row: DiagnosisRow): Promise<boolean> =>
    (await db.visitNote.count({
      where: {
        patientId,
        status: "FINALIZED",
        id: { not: visitNoteId },
        ...(row.icd10Code
          ? { diagnosisCode: row.icd10Code }
          : { diagnosisCode: null, diagnosisName: row.label }),
      },
    })) > 0;

  let currentId: string | null = null;
  let action: "created" | "updated" | null = null;

  if (code || name) {
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
      currentId = existing.id;
      action = "updated";
    } else {
      // The row this note created for the diagnosis it had before: move it
      // instead of leaving it behind («переносить»).
      let movable: DiagnosisRow | null = null;
      for (const row of owned) {
        if (sameDiagnosis(row, code, name)) continue;
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
        currentId = movable.id;
        action = "updated";
      } else {
        const created = await db.patientDiagnosis.create({
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
        currentId = created.id;
        action = "created";
      }
    }
  }

  // The rest of what this note created and no longer says.
  let resolvedAny = false;
  for (const row of owned) {
    if (row.id === currentId || row.status !== "ACTIVE") continue;
    if (sameDiagnosis(row, code, name)) continue;
    if (await heldElsewhere(row)) continue;
    await db.patientDiagnosis.update({
      where: { id: row.id },
      data: {
        status: "RESOLVED",
        notes: withLine(
          row.notes,
          code || name
            ? `Снят: в заключении исправлен на ${code ?? name}.`
            : "Снят: диагноз убран из заключения.",
        ),
      },
      select: { id: true },
    });
    resolvedAny = true;
  }

  if (action || resolvedAny) {
    // The patient card and the doctor's drug check read these rows (G3-02).
    await publishMedicalRecordChanged(tx, {
      ctx: args.ctx,
      clinicId: args.clinicId,
      payload: {
        patientId,
        record: "diagnosis",
        action: action ?? "updated",
        ...(currentId ? { entityId: currentId } : {}),
      },
    });
  }

  return { patientDiagnosisId: currentId };
}
