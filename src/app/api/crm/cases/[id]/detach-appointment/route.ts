/**
 * POST /api/crm/cases/[id]/detach-appointment
 *
 * Unlinks an appointment from this case (sets Appointment.medicalCaseId =
 * null). The appointment row itself stays alive — only the grouping is
 * removed. Detaching an appointment that belongs to a different case (or
 * to no case at all) is a 400, not a silent no-op, so the UI can show a
 * proper conflict message.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound } from "@/server/http";
import { AttachAppointmentSchema } from "@/server/schemas/medical-case";
import { recomputeAppointmentPrice } from "@/server/pricing/recompute-appointment-price";

function caseIdFromUrl(request: Request): string {
  // /api/crm/cases/[id]/detach-appointment → [id] is segment[-2].
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: AttachAppointmentSchema,
  },
  async ({ request, body }) => {
    const caseId = caseIdFromUrl(request);

    const mcase = await prisma.medicalCase.findUnique({
      where: { id: caseId },
      select: { id: true, clinicId: true },
    });
    if (!mcase) return notFound();

    const appt = await prisma.appointment.findUnique({
      where: { id: body.appointmentId },
      select: {
        id: true,
        clinicId: true,
        medicalCaseId: true,
      },
    });
    if (!appt) return notFound();

    if (mcase.clinicId !== appt.clinicId) {
      return err("Forbidden", 403, { reason: "cross_tenant" });
    }
    if (appt.medicalCaseId !== caseId) {
      return err("ValidationError", 400, { reason: "not_attached_to_case" });
    }

    // Detach + reprice the appointment itself (now case-less, so any prior
    // free-repeat discount unwinds back to full price) plus every sibling
    // remaining in the case (if the detached visit was the chronological
    // first, the next-earliest sibling becomes the new "first" and its
    // own pricing flips back to full).
    const recomputed = await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appt.id },
        data: { medicalCaseId: null } as never,
      });
      const remaining = await tx.appointment.findMany({
        where: { medicalCaseId: caseId },
        select: { id: true },
      });
      const ids = new Set<string>([appt.id, ...remaining.map((r) => r.id)]);
      const results = [];
      for (const id of ids) {
        results.push(await recomputeAppointmentPrice(tx, id));
      }
      return results;
    });

    const updated = await prisma.appointment.findUniqueOrThrow({
      where: { id: appt.id },
      select: {
        id: true,
        date: true,
        time: true,
        durationMin: true,
        status: true,
        doctorId: true,
        patientId: true,
        priceFinal: true,
        medicalCaseId: true,
        doctor: {
          select: { id: true, nameRu: true, nameUz: true, color: true },
        },
        primaryService: {
          select: { id: true, nameRu: true, nameUz: true },
        },
      },
    });

    await audit(request, {
      action: "medical_case.detach_appointment",
      entityType: "MedicalCase",
      entityId: caseId,
      meta: { appointmentId: appt.id },
    });
    for (const r of recomputed) {
      if (r.reason === "free_repeat") {
        await audit(request, {
          action: "appointment.free_repeat_applied",
          entityType: "Appointment",
          entityId: r.appointmentId,
          meta: {
            caseId,
            daysFromFirst: r.daysFromFirst,
            savedAmount: r.savedAmount,
            trace: r.trace,
            triggeredBy: "detach",
          },
        });
      }
    }

    return ok(updated);
  }
);
