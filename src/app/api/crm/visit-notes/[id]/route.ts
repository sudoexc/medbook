/**
 * /api/crm/visit-notes/[id] — GET single note, PATCH autosave.
 *
 * PATCH is hit by the reception editor with 1.5s debounce and by the
 * conclusion screen's in-window corrections. Only the owning doctor writes;
 * a signed note is writable for 24h from its first signature, and every such
 * correction recomposes the patient handout (audit VW-02) and is recorded as
 * an immutable revision next to the state it replaced (audit G1-01).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, forbidden, notFound, conflict } from "@/server/http";
import { UpdateVisitNoteSchema } from "@/server/schemas/visit-note";
import { isEditWindowExpired } from "@/server/visit-notes/edit-window";
import { learnClinicDiagnosis } from "@/server/icd10/clinic-catalog";
import { didPrescriptionsChange } from "@/server/visit-notes/prescription-diff";
import {
  composeNoteHandout,
  touchesHandout,
} from "@/server/visit-notes/handout";
import {
  ensureSignedStateOnRecord,
  recordSignedEdit,
  revisionContentOf,
} from "@/server/visit-notes/revisions";
import { storageKeyFromUrl } from "@/lib/storage-ref";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const note = await prisma.visitNote.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true } },
        appointment: { select: { id: true, date: true, status: true } },
        doctor: {
          select: {
            specializationRu: true,
            specializationUz: true,
            user: { select: { name: true } },
          },
        },
        clinic: { select: { nameRu: true, nameUz: true } },
        visitPrescriptions: {
          orderBy: { sortOrder: "asc" },
          // Carry the packaging photo so the prescription rows can show the
          // box: the doctor turns the screen to the patient, and the same
          // image travels on to the handout.
          include: { drug: { select: { photoUrl: true } } },
        },
      },
    });
    if (!note) return notFound();

    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor || doctor.id !== note.doctorId) return forbidden();
    }

    return ok(note);
  },
);

export const PATCH = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: UpdateVisitNoteSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);
    const before = await prisma.visitNote.findUnique({
      where: { id },
      // The handout's letterhead, for recomposing it after a correction.
      include: {
        patient: { select: { fullName: true } },
        doctor: { select: { nameRu: true, specializationRu: true } },
        clinic: { select: { nameRu: true } },
        appointment: { select: { date: true } },
      },
    });
    if (!before) return notFound();

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, nameRu: true },
    });
    if (!doctor || doctor.id !== before.doctorId) return forbidden();

    // 24h post-finalization edit window. Beyond that the note is locked —
    // corrections switch to the append-only amendment flow (see
    // .../amendments/route.ts for the medico-legal rationale).
    // The clock runs from the FIRST signature, not the current one, and it
    // applies to a DRAFT that was signed before: reverting a completed visit
    // un-signs the note, and that must never hand back a destructive-edit
    // window on a document signed weeks ago (that is what amendments are
    // for). Only a note that was never signed is freely editable.
    const signedAt = before.firstFinalizedAt ?? before.finalizedAt;
    if (before.status === "FINALIZED" || signedAt) {
      if (isEditWindowExpired(signedAt)) {
        return err("Forbidden", 403, { reason: "edit_window_expired" });
      }
    }

    // Optimistic locking — the same note can be open in the reception editor
    // and in /doctor/conclusions/[id] at once. Without a version check the
    // slower window silently erases the faster one (worst failure class for a
    // clinical document). When the client sends the `updatedAt` it last saw,
    // reject the write if the row moved on; the client shows the doctor an
    // explicit "changed in another window" message instead of overwriting.
    // Compare on epoch millis: Prisma serialises DateTime via toISOString(),
    // so a round-tripped token is millisecond-exact.
    if (body.expectedUpdatedAt != null) {
      const expectedMs = Date.parse(body.expectedUpdatedAt);
      if (expectedMs !== before.updatedAt.getTime()) {
        return conflict("version_conflict", {
          currentUpdatedAt: before.updatedAt.toISOString(),
        });
      }
    }

    const data: Record<string, unknown> = {};
    for (const key of [
      "complaints",
      "anamnesis",
      "examination",
      "prescriptions",
      "advice",
    ] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.diagnosisCode !== undefined) data.diagnosisCode = body.diagnosisCode;
    if (body.diagnosisName !== undefined) data.diagnosisName = body.diagnosisName;
    if (body.bodyMarkdown !== undefined) data.bodyMarkdown = body.bodyMarkdown;
    if (body.patientHandoutMarkdown !== undefined) {
      data.patientHandoutMarkdown = body.patientHandoutMarkdown;
    }
    if (body.followUpDays !== undefined) data.followUpDays = body.followUpDays;
    if (body.followUpNote !== undefined) data.followUpNote = body.followUpNote;
    if (body.dynamics !== undefined) data.dynamics = body.dynamics;
    if (body.dynamicsNote !== undefined) data.dynamicsNote = body.dynamicsNote;
    // Ф8 — replace-all, как visitPrescriptions; очистка = пустой массив
    // (plain null в Json-колонку Prisma не принимает).
    if (body.bodyMap !== undefined) data.bodyMap = body.bodyMap;

    const changedFields = Object.keys(data);
    const rxRows = body.visitPrescriptions;
    const isSigned = before.status === "FINALIZED";
    // Signed once, reopened by a visit revert: still holds what was signed
    // until the first edit overwrites it.
    const isReopened = !isSigned && before.firstFinalizedAt != null;

    // The stored rows: compared against below, and part of the signed state
    // a correction must keep on record (G1-01).
    const beforeRows =
      rxRows !== undefined ||
      ((isSigned || isReopened) && changedFields.length > 0)
        ? await prisma.visitPrescription.findMany({
            where: { visitNoteId: id },
            orderBy: { sortOrder: "asc" },
            select: {
              drugId: true,
              displayName: true,
              form: true,
              strength: true,
              dose: true,
              timesOfDay: true,
              mealRelation: true,
              durationDays: true,
              instructionRu: true,
              instructionUz: true,
              remindPatient: true,
              sortOrder: true,
            },
          })
        : null;

    // Did the prescription list ACTUALLY change, or did the editor just resend
    // the current one? The constructor saves replace-all on every interaction
    // (including no-op ones like collapsing a row), so `rxRows !== undefined`
    // alone is far too coarse a trigger for the medication-bridge rebuild
    // below. Compare against the stored rows on the fields that reach the
    // patient — anything that alters WHAT they take, HOW MUCH, WHEN, FOR HOW
    // LONG, or WHETHER they are reminded at all.
    let rxChanged = false;
    if (rxRows !== undefined) {
      rxChanged = didPrescriptionsChange(beforeRows ?? [], rxRows);
      if (rxChanged) changedFields.push("visitPrescriptions");
    }

    // VW-02 — the handout is the patient's copy of the diagnosis,
    // prescriptions, advice and follow-up. On a signed note it used to stay
    // as composed at the first signature, so a corrected dose reached the
    // patient's PDF only in the schedule grid, under a text still naming the
    // old one, and the Mini App kept the old text entirely. Recompose it from
    // the state this correction produces; the worker then re-renders the PDF
    // (handoutStaleAt below). Deliberately after changedFields is captured:
    // it is derived, not something the doctor edited.
    if (
      isSigned &&
      body.patientHandoutMarkdown === undefined &&
      touchesHandout(changedFields)
    ) {
      const next = { ...before, ...data } as typeof before;
      data.patientHandoutMarkdown = composeNoteHandout(before, {
        diagnosisName: next.diagnosisName,
        complaints: next.complaints,
        prescriptions: next.prescriptions,
        advice: next.advice,
        followUpNote: next.followUpNote,
        visitPrescriptions: rxChanged && rxRows ? rxRows : (beforeRows ?? []),
      });
    }

    // A finalized note already has its CONCLUSION PDF rendered (the patient
    // sees it in the Mini App and via the QR link), so an accepted in-window
    // edit makes that file stale. Stamp the convergence anchor; the handout
    // worker sweeps it up and re-renders it with the same verifyToken and
    // documentNumber, so the printed QR keeps resolving, under a NEW storage
    // key: the file issued before stays readable (G1-01).
    // Deliberately after changedFields is captured: the anchor is a technical
    // field and must not appear in the audit/event field list.
    if (before.status === "FINALIZED" && changedFields.length > 0) {
      data.handoutStaleAt = new Date();
    }

    // ── The clinical half of the same problem ────────────────────────────
    // The PDF is not the only artefact a finalized note feeds: `remindPatient`
    // rows are mirrored into `Prescription` courses that drive the patient's
    // medication reminders in the Mini App. That mirror ran exactly once,
    // gated on `medicationsBridgedAt IS NULL`, so a dosage corrected inside
    // the 24h window re-rendered the PDF but left the patient being reminded
    // on the WITHDRAWN schedule — they would keep taking a regimen the doctor
    // had already cancelled.
    //
    // Clearing the anchor puts the note back into the bridge sweep, which is
    // now reconciling rather than create-only (see `bridgeNote`): it updates
    // surviving courses in place and cancels the ones the doctor removed.
    // Deliberately gated on `rxChanged` — a typo fix in the conclusion text
    // must not disturb courses the patient is already following, and must not
    // re-emit `prescription.created` notifications.
    if (before.status === "FINALIZED" && rxChanged) {
      data.medicationsBridgedAt = null;
    }

    const correlationId = newCorrelationId();
    const actorUserId = ctx.userId || null;
    let revisions: { before: number; after: number } | null = null;

    const updated = await prisma.$transaction(async (tx) => {
      // Ф2 — structured prescriptions: replace-all, consistent with the
      // autosave model (the editor always sends the full current list).
      // Runs before the note update so the returned include is fresh.
      if (rxRows !== undefined) {
        await tx.visitPrescription.deleteMany({
          where: { visitNoteId: id },
        });
        if (rxRows.length > 0) {
          await tx.visitPrescription.createMany({
            data: rxRows.map((r, i) => ({
              visitNoteId: id,
              drugId: r.drugId ?? null,
              displayName: r.displayName,
              form: r.form ?? null,
              strength: r.strength ?? null,
              dose: r.dose,
              timesOfDay: r.timesOfDay,
              mealRelation: r.mealRelation,
              durationDays: r.durationDays ?? null,
              instructionRu: r.instructionRu ?? null,
              instructionUz: r.instructionUz ?? null,
              remindPatient: r.remindPatient,
              sortOrder: i,
              // clinicId is injected by the tenant extension at runtime.
            })) as never,
          });
        }
      }

      const row = await tx.visitNote.update({
        where: { id },
        data: data as never,
        include: {
          visitPrescriptions: {
            orderBy: { sortOrder: "asc" },
            include: { drug: { select: { photoUrl: true } } },
          },
        },
      });

      // G1-01 — a correction of a signed note overwrites it in place, so
      // both states go on record here, in the same transaction: the one
      // being replaced (unless a revision already holds it) and the new one,
      // with who made it. The UPDATE above holds the row lock, so revision
      // numbers of concurrent writers cannot collide.
      const issuedPdfKey = async () =>
        storageKeyFromUrl(
          (
            await tx.document.findUnique({
              where: { visitNoteId: id },
              select: { fileUrl: true },
            })
          )?.fileUrl,
        );
      if (isSigned && changedFields.length > 0) {
        revisions = await recordSignedEdit(tx, {
          clinicId: before.clinicId,
          visitNoteId: id,
          before: revisionContentOf(before, beforeRows ?? []),
          after: revisionContentOf(row, row.visitPrescriptions),
          authorUserId: actorUserId,
          authorName: doctor.nameRu,
          issuedPdfKey,
        });
      } else if (isReopened && changedFields.length > 0) {
        // While reopened the note is a draft again: its edits are not
        // versioned one by one (the next signature records the result), but
        // the signed state they overwrite must survive them.
        await ensureSignedStateOnRecord(tx, {
          clinicId: before.clinicId,
          visitNoteId: id,
          content: revisionContentOf(before, beforeRows ?? []),
          issuedPdfKey,
        });
      }

      // Skip the envelope when the autosave was a no-op — the editor sends a
      // PATCH on every debounced keystroke even if nothing changed.
      if (changedFields.length > 0) {
        const envelope: EventEnvelopeInput = {
          type: "visit-note.draftSaved",
          correlationId,
          actor: {
            role: "DOCTOR",
            userId: actorUserId,
            patientId: null,
            onBehalfOfPatientId: null,
            label: actorUserId ? `user:${actorUserId}` : "user:anonymous",
          },
          surface: "DOCTOR_CABINET",
          tenantScope: {
            clinicId: before.clinicId,
            doctorId: before.doctorId,
            patientId: before.patientId,
            appointmentId: before.appointmentId ?? undefined,
          },
          payload: {
            visitNoteId: row.id,
            appointmentId: row.appointmentId ?? undefined,
            doctorId: row.doctorId,
            patientId: row.patientId,
            changedFields,
          },
        };
        await publishViaOutbox(tx, envelope);
      }
      return row;
    });

    await audit(request, {
      action: "visit_note.update",
      entityType: "VisitNote",
      entityId: id,
      // The values themselves live in VisitNoteRevision: `revisions` names
      // the before/after rows of a signed-note correction.
      meta: {
        fields: changedFields,
        correlationId,
        ...(revisions ? { revisions } : {}),
      },
    });

    // A diagnosis written in the doctor's own words (or with a code the
    // static list lacks) joins the clinic's list the moment it is chosen,
    // not at signing: most visits here are never signed, so a signing-only
    // gate meant nothing was ever shared. Choosing is already deliberate —
    // the field only saves on a pick, never per keystroke. The use is
    // counted at signing, as before. Fire-and-forget.
    if (
      body.diagnosisName !== undefined &&
      (body.diagnosisName ?? null) !== (before.diagnosisName ?? null)
    ) {
      void learnClinicDiagnosis({
        code: updated.diagnosisCode ?? null,
        nameRu: updated.diagnosisName ?? null,
        createdById: ctx.userId,
        countUse: false,
      });
    }

    return ok(updated);
  },
);
