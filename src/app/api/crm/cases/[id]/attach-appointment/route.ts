/**
 * POST /api/crm/cases/[id]/attach-appointment
 *
 * Links an appointment to a medical case by setting Appointment.medicalCaseId.
 * Both rows are tenant-auto-scoped, so cross-clinic attempts return 404 here
 * (the appointment lookup misses) — never silently succeed.
 *
 * Additional invariant: the appointment must belong to the SAME patient as
 * the case. We don't move appointments between patients.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound } from "@/server/http";
import { AttachAppointmentSchema } from "@/server/schemas/medical-case";
import { attachAppointmentToCase } from "@/server/cases/attach";

function caseIdFromUrl(request: Request): string {
  // /api/crm/cases/[id]/attach-appointment → [id] is segment[-2].
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
      select: { id: true, patientId: true, clinicId: true },
    });
    if (!mcase) return notFound();

    const appt = await prisma.appointment.findUnique({
      where: { id: body.appointmentId },
      select: {
        id: true,
        patientId: true,
        clinicId: true,
        medicalCaseId: true,
      },
    });
    if (!appt) return notFound();

    // Belt-and-suspenders cross-tenant guard. The Prisma extension already
    // filters by clinicId so a cross-tenant appointment id surfaces as 404
    // above, but we re-check explicitly so any future bypass (raw SQL,
    // SUPER_ADMIN context drift) still fails closed.
    if (mcase.clinicId !== appt.clinicId) {
      return err("Forbidden", 403, { reason: "cross_tenant" });
    }
    if (mcase.patientId !== appt.patientId) {
      return err("ValidationError", 400, { reason: "patient_mismatch" });
    }

    // Attach + reprice every visit whose "first vs repeat" position can flip
    // (the visit, the destination case, the case it left). Shared with the
    // Mini App paths so the price never depends on the channel (PT-02).
    const recomputed = await prisma.$transaction((tx) =>
      attachAppointmentToCase(tx, {
        appointmentId: appt.id,
        caseId,
        previousCaseId: appt.medicalCaseId,
      }),
    );

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
      action: "medical_case.attach_appointment",
      entityType: "MedicalCase",
      entityId: caseId,
      meta: {
        appointmentId: appt.id,
        previousCaseId: appt.medicalCaseId,
      },
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
            triggeredBy: "attach",
          },
        });
      }
    }

    return ok(updated);
  }
);
