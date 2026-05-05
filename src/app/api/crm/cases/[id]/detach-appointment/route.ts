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

    const updated = await prisma.appointment.update({
      where: { id: appt.id },
      data: { medicalCaseId: null } as never,
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

    return ok(updated);
  }
);
