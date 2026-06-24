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
import { ok, err, forbidden, notFound } from "@/server/http";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";
import { fireTrigger } from "@/server/notifications/triggers";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";
import { emitAppointmentChangeViaOutbox } from "@/server/appointments/emit-change";
import { allocateDocumentNumber } from "@/server/services/document-number";

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
      },
    });
    if (!note) return notFound();

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor || doctor.id !== note.doctorId) return forbidden();

    if (note.status === "FINALIZED") {
      return ok({ note, appointment: note.appointment, alreadyFinalized: true });
    }

    // Ф0 — a conclusion without a diagnosis is legally void. Hard gate; the
    // UI disables the button too, this is the API backstop. Empty sections
    // (complaints/advice/handout) are allowed but confirmed client-side.
    if (!note.diagnosisCode) {
      return err("DIAGNOSIS_REQUIRED", 400);
    }

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
        data: { status: "FINALIZED", finalizedAt: now, documentNumber },
      });

      let updatedAppt = note.appointment;
      let apptEventId: string | undefined;
      if (note.appointment.status !== "COMPLETED") {
        // Mirror /api/crm/appointments/[id] PATCH: shrink endDate when the
        // doctor closes the visit ahead of schedule so the freed tail is
        // re-bookable. Minimum 5 min.
        const minEnd = new Date(note.appointment.date.getTime() + 5 * 60_000);
        const newEnd = now < minEnd ? minEnd : now < note.appointment.endDate ? now : note.appointment.endDate;
        const durationMin = Math.max(
          5,
          Math.round((newEnd.getTime() - note.appointment.date.getTime()) / 60_000),
        );
        updatedAppt = await tx.appointment.update({
          where: { id: note.appointment.id },
          data: {
            status: "COMPLETED",
            completedAt: now,
            endDate: newEnd,
            durationMin,
          },
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
      const existingDx = await tx.patientDiagnosis.findFirst({
        where: { patientId: note.patientId, icd10Code: note.diagnosisCode },
        select: { id: true },
      });
      const patientDiagnosis = existingDx
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
              label: note.diagnosisName ?? note.diagnosisCode ?? "",
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
        patientDiagnosisId: patientDiagnosis.id,
      };
    });

    if (note.appointment.status !== "COMPLETED") {
      await bumpPatientLastContact(
        note.patientId,
        result.appointment.completedAt ?? new Date(),
      );
      // Auto-messages widget — "Спасибо за визит". Idempotent with the
      // appointment-PATCH completion path (shared NotificationSend gate).
      fireTrigger({
        kind: "appointment.completed",
        appointmentId: note.appointment.id,
      });
    }

    await audit(request, {
      action: "visit_note.finalize",
      entityType: "VisitNote",
      entityId: id,
      meta: {
        appointmentId: note.appointment.id,
        correlationId,
        documentNumber: result.note.documentNumber,
        patientDiagnosisId: result.patientDiagnosisId,
      },
    });

    return ok({ note: result.note, appointment: result.appointment });
  },
);

// Avoid silent 405s being mistaken for a missing route.
export const GET = () => err("Method Not Allowed", 405);
