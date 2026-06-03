/**
 * POST /api/crm/cases/[id]/prescriptions — create a prescription on a case.
 *
 * GET-on-case is folded into the existing case detail endpoint
 * (`/api/crm/cases/[id]`) — see DETAIL_INCLUDE.prescriptions there.
 *
 * Doctor must belong to the case's clinic; the patient is taken from the
 * case (we don't accept it from the body to prevent cross-patient writes).
 * Domain logic lives in `prescribeMedication` — this handler is authz +
 * input shaping.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound } from "@/server/http";
import { prescribeMedication } from "@/server/prescriptions/prescribe";
import { CreatePrescriptionSchema } from "@/server/schemas/prescription";

function caseIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR"],
    bodySchema: CreatePrescriptionSchema,
  },
  async ({ request, body, ctx }) => {
    const caseId = caseIdFromUrl(request);

    const mcase = await prisma.medicalCase.findUnique({
      where: { id: caseId },
      select: { id: true, patientId: true, clinicId: true },
    });
    if (!mcase) return notFound();

    const doctor = await prisma.doctor.findUnique({
      where: { id: body.doctorId },
      select: { id: true, clinicId: true },
    });
    if (!doctor) {
      return err("ValidationError", 400, { reason: "doctor_not_found" });
    }
    if (doctor.clinicId !== mcase.clinicId) {
      return err("Forbidden", 403, { reason: "cross_tenant" });
    }

    const startsAt = body.schedule.startsAt
      ? new Date(body.schedule.startsAt)
      : new Date();

    const actorId = ctx.kind === "TENANT" ? ctx.userId || null : null;
    const actorRole = ctx.kind === "TENANT" ? ctx.role : "SYSTEM";

    const { prescription } = await prescribeMedication({
      clinicId: mcase.clinicId,
      caseId,
      patientId: mcase.patientId,
      doctorId: doctor.id,
      drugName: body.drugName,
      dosage: body.dosage,
      schedule: {
        times: body.schedule.times,
        days: body.schedule.days ?? null,
        startsAt: startsAt.toISOString(),
      },
      notes: body.notes ?? null,
      remindersEnabled: body.remindersEnabled ?? false,
      status: body.status ?? "ACTIVE",
      actorId,
      actorRole: actorRole === "DOCTOR" ? "DOCTOR" : "ADMIN",
      surface: actorRole === "DOCTOR" ? "DOCTOR_CABINET" : "CRM",
    });

    return ok(prescription);
  },
);
