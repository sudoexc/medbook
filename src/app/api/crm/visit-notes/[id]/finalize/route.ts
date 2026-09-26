/**
 * /api/crm/visit-notes/[id]/finalize — atomically close out a reception.
 *
 *   1. VisitNote.status = FINALIZED + finalizedAt = now
 *   2. Appointment.status = COMPLETED + completedAt = now (idempotent)
 *
 * Payment-due signalling and NPS request are handled by existing flows:
 *   - The unpaid-appointment list is what the reception desk watches; no
 *     dedicated Action row is created here.
 *   - The post-visit-nps worker auto-picks up rows by `completedAt`.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, forbidden, notFound, conflict } from "@/server/http";
import {
  canTransitionAt,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";
import {
  bumpPatientLastContact,
  refreshPatientVisitStats,
} from "@/server/patient/last-contacted";
import { fireTrigger } from "@/server/notifications/triggers";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";
import { emitAppointmentChangeViaOutbox } from "@/server/appointments/emit-change";
import { completionFields } from "@/server/appointments/completion";
import { learnClinicDiagnosis } from "@/server/icd10/clinic-catalog";
import { allocateDocumentNumber } from "@/server/services/document-number";
import { composeNoteHandout } from "@/server/visit-notes/handout";
import {
  appendRevision,
  changedRevisionFields,
  ensureSignedStateOnRecord,
  latestRevision,
  revisionContentOf,
} from "@/server/visit-notes/revisions";
import { storageKeyFromUrl } from "@/lib/storage-ref";

/**
 * Thrown inside the transaction when the visit left IN_PROGRESS between the
 * guard above and the write (reception cancelled it that very second). The
 * whole signature rolls back and the route answers like the guard does.
 */
class AppointmentNoLongerActive extends Error {}

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../visit-notes/[id]/finalize
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);

    const note = await prisma.visitNote.findUnique({
      where: { id },
      include: {
        appointment: {
          select: {
            id: true,
            status: true,
            completedAt: true,
            date: true,
            endDate: true,
            queueStatus: true,
            doctorId: true,
            patientId: true,
            cabinetId: true,
          },
        },
        // Everything the handout composer needs, in case we have to build the
        // patient copy ourselves below.
        patient: { select: { fullName: true } },
        doctor: {
          select: { nameRu: true, specializationRu: true },
        },
        clinic: { select: { nameRu: true } },
        // In order: the handout lists them and the revision snapshots them
        // exactly as the doctor arranged them.
        visitPrescriptions: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!note) return notFound();

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, nameRu: true },
    });
    if (!doctor || doctor.id !== note.doctorId) return forbidden();

    if (note.status === "FINALIZED") {
      return ok({ note, appointment: note.appointment, alreadyFinalized: true });
    }

    // VW-03 — signing closes the visit, so it obeys the same state machine
    // as every other completion (the appointment PATCH checks
    // `canTransitionAt` too). It used to test only `!== COMPLETED` and apply
    // the completion fields regardless: a visit reception had cancelled
    // while the doctor's screen was stale became COMPLETED, the patient got
    // «Спасибо за визит» and an NPS request, and the visit counted in the
    // stats. Only IN_PROGRESS may close; a visit already COMPLETED keeps
    // being signable (the «sign later» path from «Заключения»). Refused
    // before anything is written: no number, no revision, no triggers.
    if (note.appointment.status !== "COMPLETED") {
      const closable = canTransitionAt(
        note.appointment.status as AppointmentStatus,
        "COMPLETED",
        note.appointment.date,
      );
      if (!closable.ok) {
        return conflict("appointment_not_active", {
          appointmentId: note.appointment.id,
          from: note.appointment.status,
        });
      }
    }

    // The diagnosis is NOT a hard gate any more (clinic decision
    // 23.09.2026). It went through three stages: an ICD-10 code was
    // required, then free text counted too, and now the visit closes
    // without either. The reason is real work: a patient who came only for
    // an EEG or a repeat dressing has no new diagnosis to state, and the
    // doctor was stuck inventing one to finish the visit — which is worse
    // data than none. The UI still asks for confirmation before signing an
    // undiagnosed conclusion, so it stays a decision rather than an
    // accident, and `PatientDiagnosis` simply gets no row.

    // The patient's PDF is rendered from `patientHandoutMarkdown` alone — the
    // clinical body deliberately never reaches them — and since the handout
    // tab was removed (21.09.2026) nobody writes it by hand. Compose it from
    // what is being signed: diagnosis, prescriptions, advice, follow-up.
    //
    // At EVERY signature, not only when empty (audit VW-02): a visit reverted,
    // corrected and signed again kept the handout of the first signature, so
    // the patient's PDF and Mini App listed a drug the doctor had removed.
    // Null when there is genuinely nothing to say: no blank sheet is issued.
    const composedHandout = composeNoteHandout(note, {
      diagnosisName: note.diagnosisName,
      complaints: note.complaints,
      prescriptions: note.prescriptions,
      advice: note.advice,
      followUpNote: note.followUpNote,
      visitPrescriptions: note.visitPrescriptions ?? [],
    });

    const correlationId = newCorrelationId();
    const actorUserId = ctx.userId || null;
    const actorLabel = actorUserId ? `user:${actorUserId}` : "user:anonymous";

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      // Ф0 — allocate the human-readable conclusion number inside the same
      // transaction so an aborted finalize never burns a number. Re-finalize
      // after the 24h-edit reopen keeps the original number.
      const documentNumber =
        note.documentNumber ??
        (await allocateDocumentNumber(note.clinicId, "CONCLUSION", tx, now));
      const updatedNote = await tx.visitNote.update({
        where: { id },
        data: {
          status: "FINALIZED",
          finalizedAt: now,
          // Stamped only on the first signature — it is the immutability
          // clock, and a re-sign after a revert must not restart it.
          ...(note.firstFinalizedAt ? {} : { firstFinalizedAt: now }),
          documentNumber,
          patientHandoutMarkdown: composedHandout,
        },
      });

      // G1-01 — what was signed, kept immutable next to the note: the note
      // itself stays correctable for 24h, this row does not. A re-signature
      // (after a visit revert) first makes sure the previous signed state is
      // on record, then notes what the new one changed.
      const signedContent = revisionContentOf(
        updatedNote,
        note.visitPrescriptions ?? [],
      );
      const previous = !note.firstFinalizedAt
        ? await latestRevision(tx, id)
        : await ensureSignedStateOnRecord(tx, {
            clinicId: note.clinicId,
            visitNoteId: id,
            content: revisionContentOf(note, note.visitPrescriptions ?? []),
            issuedPdfKey: async () =>
              storageKeyFromUrl(
                (
                  await tx.document.findUnique({
                    where: { visitNoteId: id },
                    select: { fileUrl: true },
                  })
                )?.fileUrl,
              ),
          });
      const signedRevision = await appendRevision(tx, {
        clinicId: note.clinicId,
        visitNoteId: id,
        revision: (previous?.revision ?? 0) + 1,
        kind: "SIGNED",
        content: signedContent,
        changedFields: previous
          ? changedRevisionFields(
              previous.content as Record<string, unknown>,
              signedContent,
            )
          : [],
        authorUserId: actorUserId,
        authorName: doctor.nameRu,
        createdAt: now,
      });

      let updatedAppt = note.appointment;
      let apptEventId: string | undefined;
      if (note.appointment.status !== "COMPLETED") {
        // Mirror /api/crm/appointments/[id] PATCH: shrink endDate when the
        // doctor closes the visit ahead of schedule so the freed tail is
        // re-bookable. Both status columns move together — see
        // `completionFields`.
        updatedAppt = await tx.appointment
          .update({
            // Conditional on the status the guard approved (VW-03): a cancel
            // that lands between the guard and this write makes the update
            // match nothing instead of completing a cancelled visit.
            where: { id: note.appointment.id, status: note.appointment.status },
            data: completionFields({
              now,
              date: note.appointment.date,
              endDate: note.appointment.endDate,
            }),
            select: {
              id: true,
              status: true,
              completedAt: true,
              date: true,
              endDate: true,
              queueStatus: true,
              doctorId: true,
              patientId: true,
              cabinetId: true,
            },
          })
          .catch((e: unknown) => {
            // P2025: no row matched the conditional where.
            if ((e as { code?: string } | null)?.code === "P2025") {
              throw new AppointmentNoLongerActive();
            }
            throw e;
          });
        const { eventId } = await emitAppointmentChangeViaOutbox({
          tx,
          kind: "statusChanged",
          before: {
            status: note.appointment.status,
            queueStatus: note.appointment.queueStatus,
          },
          after: {
            id: updatedAppt.id,
            doctorId: updatedAppt.doctorId,
            patientId: updatedAppt.patientId,
            cabinetId: updatedAppt.cabinetId,
            status: updatedAppt.status,
            queueStatus: updatedAppt.queueStatus,
            date: updatedAppt.date,
          },
          clinicId: note.clinicId,
          actorId: actorUserId,
          actorRole: "DOCTOR",
          actorLabel,
          surface: "DOCTOR_CABINET",
          correlationId,
          alsoQueueUpdate: updatedAppt.queueStatus !== note.appointment.queueStatus,
        });
        apptEventId = eventId;
      }

      // Ф7 — карточка пациента наполняется сама: диагноз приёма становится
      // (или снова становится) ACTIVE в PatientDiagnosis. diagnosedAt
      // существующей записи не трогаем — дата первичной постановки ценнее.
      // Match on the code when there is one; fall back to the label for
      // free-text diagnoses. Matching a null code would collapse every
      // uncoded diagnosis a patient ever had into one row.
      //
      // No diagnosis at all (now allowed) means nothing to record here.
      const hasDiagnosis = Boolean(
        note.diagnosisCode || note.diagnosisName?.trim(),
      );
      const existingDx = !hasDiagnosis
        ? null
        : await tx.patientDiagnosis.findFirst({
        where: note.diagnosisCode
          ? { patientId: note.patientId, icd10Code: note.diagnosisCode }
          : {
              patientId: note.patientId,
              icd10Code: null,
              label: note.diagnosisName!.trim(),
            },
        select: { id: true },
      });
      const patientDiagnosis = !hasDiagnosis
        ? null
        : existingDx
        ? await tx.patientDiagnosis.update({
            where: { id: existingDx.id },
            data: {
              status: "ACTIVE",
              ...(note.diagnosisName ? { label: note.diagnosisName } : {}),
            },
            select: { id: true },
          })
        : await tx.patientDiagnosis.create({
            data: {
              clinicId: note.clinicId,
              patientId: note.patientId,
              icd10Code: note.diagnosisCode,
              label: note.diagnosisName?.trim() || note.diagnosisCode || "",
              diagnosedAt: now,
              status: "ACTIVE",
            },
            select: { id: true },
          });

      const visitNoteEnvelope: EventEnvelopeInput = {
        type: "visit-note.finalized",
        correlationId,
        causedByEventId: apptEventId,
        actor: {
          role: "DOCTOR",
          userId: actorUserId,
          patientId: null,
          onBehalfOfPatientId: null,
          label: actorLabel,
        },
        surface: "DOCTOR_CABINET",
        tenantScope: {
          clinicId: note.clinicId,
          doctorId: note.doctorId,
          patientId: note.patientId,
          appointmentId: note.appointment.id,
        },
        payload: {
          visitNoteId: updatedNote.id,
          appointmentId: note.appointment.id,
          doctorId: note.doctorId,
          patientId: note.patientId,
          finalizedAt: updatedNote.finalizedAt?.toISOString(),
        },
      };
      await publishViaOutbox(tx, visitNoteEnvelope);

      return {
        note: updatedNote,
        appointment: updatedAppt,
        patientDiagnosisId: patientDiagnosis?.id ?? null,
        revision: signedRevision.revision,
      };
    }).catch((e: unknown) => {
      if (e instanceof AppointmentNoLongerActive) return null;
      throw e;
    });
    if (!result) {
      return conflict("appointment_not_active", {
        appointmentId: note.appointment.id,
        from: note.appointment.status,
      });
    }

    if (note.appointment.status !== "COMPLETED") {
      await bumpPatientLastContact(
        note.patientId,
        result.appointment.completedAt ?? new Date(),
      );
      // Same denormalised stats as the appointment-PATCH completion path.
      await refreshPatientVisitStats(note.patientId);
      // Auto-messages widget — "Спасибо за визит". Idempotent with the
      // appointment-PATCH completion path (shared NotificationSend gate).
      fireTrigger({
        kind: "appointment.completed",
        appointmentId: note.appointment.id,
      });
    }

    // The clinic catalog learns from every SIGNED diagnosis — free text and
    // codes the static list lacks become suggestions for all doctors here.
    // Fire-and-forget: catalog trouble must never fail a signed conclusion.
    void learnClinicDiagnosis({
      code: note.diagnosisCode ?? null,
      nameRu: note.diagnosisName ?? null,
      createdById: actorUserId,
    });

    await audit(request, {
      action: "visit_note.finalize",
      entityType: "VisitNote",
      entityId: id,
      meta: {
        appointmentId: note.appointment.id,
        correlationId,
        documentNumber: result.note.documentNumber,
        patientDiagnosisId: result.patientDiagnosisId,
        revision: result.revision,
      },
    });

    return ok({ note: result.note, appointment: result.appointment });
  },
);

// Avoid silent 405s being mistaken for a missing route.
export const GET = () => err("Method Not Allowed", 405);
