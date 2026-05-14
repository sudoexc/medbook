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
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";

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
      include: { appointment: { select: { id: true, status: true, completedAt: true, date: true, endDate: true } } },
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

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const updatedNote = await tx.visitNote.update({
        where: { id },
        data: { status: "FINALIZED", finalizedAt: now },
      });

      let updatedAppt = note.appointment;
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
          select: { id: true, status: true, completedAt: true, date: true, endDate: true },
        });
      }

      return { note: updatedNote, appointment: updatedAppt };
    });

    await audit(request, {
      action: "visit_note.finalize",
      entityType: "VisitNote",
      entityId: id,
      meta: { appointmentId: note.appointment.id },
    });

    const tenant = getTenant();
    const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
    if (clinicId) {
      publishEventSafe(clinicId, {
        type: "appointment.statusChanged",
        payload: {
          appointmentId: note.appointment.id,
          doctorId: note.doctorId,
          patientId: note.patientId,
          status: "COMPLETED",
          previousStatus: note.appointment.status,
        },
      });
      publishEventSafe(clinicId, {
        type: "queue.updated",
        payload: {
          appointmentId: note.appointment.id,
          doctorId: note.doctorId,
          queueStatus: "COMPLETED",
          previousStatus: note.appointment.status,
        },
      });
    }

    return ok(result);
  },
);

// Avoid silent 405s being mistaken for a missing route.
export const GET = () => err("Method Not Allowed", 405);
