/**
 * POST /api/crm/cases/[id]/prescriptions — create a prescription on a case.
 *
 * GET-on-case is folded into the existing case detail endpoint
 * (`/api/crm/cases/[id]`) — see DETAIL_INCLUDE.prescriptions there.
 *
 * Doctor must belong to the case's clinic; the patient is taken from the
 * case (we don't accept it from the body to prevent cross-patient writes).
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err, notFound } from "@/server/http";
import {
  hydratePrescriptionForRead,
  serializePrescriptionForWrite,
} from "@/server/prescription/cipher-fields";
import { CreatePrescriptionSchema } from "@/server/schemas/prescription";

function caseIdFromUrl(request: Request): string {
  // /api/crm/cases/[id]/prescriptions → [id] is segment[-2].
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR"],
    bodySchema: CreatePrescriptionSchema,
  },
  async ({ request, body }) => {
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

    const writeData = serializePrescriptionForWrite({
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
    } as never);

    const created = await prisma.prescription.create({
      data: writeData as never,
      include: {
        doctor: { select: { id: true, nameRu: true, nameUz: true } },
      },
    });
    const hydrated = hydratePrescriptionForRead(created);

    await audit(request, {
      action: AUDIT_ACTION.PRESCRIPTION_CREATED,
      entityType: "Prescription",
      entityId: created.id,
      meta: {
        caseId,
        patientId: mcase.patientId,
        drugName: created.drugName,
        scheduleTimes: body.schedule.times,
        days: body.schedule.days ?? null,
        remindersEnabled: created.remindersEnabled,
      },
    });

    return ok(hydrated);
  },
);
