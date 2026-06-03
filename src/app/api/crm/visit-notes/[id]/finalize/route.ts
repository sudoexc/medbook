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
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";
import { emitAppointmentChangeViaOutbox } from "@/server/appointments/emit-change";

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

    const correlationId = newCorrelationId();
    const actorUserId = ctx.userId || null;
    const actorLabel = actorUserId ? `user:${actorUserId}` : "user:anonymous";

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const updatedNote = await tx.visitNote.update({
        where: { id },
        data: { status: "FINALIZED", finalizedAt: now },
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

      return { note: updatedNote, appointment: updatedAppt };
    });

    if (note.appointment.status !== "COMPLETED") {
      await bumpPatientLastContact(
        note.patientId,
        result.appointment.completedAt ?? new Date(),
      );
    }

    await audit(request, {
      action: "visit_note.finalize",
      entityType: "VisitNote",
      entityId: id,
      meta: { appointmentId: note.appointment.id, correlationId },
    });

    return ok(result);
  },
);

// Avoid silent 405s being mistaken for a missing route.
export const GET = () => err("Method Not Allowed", 405);
