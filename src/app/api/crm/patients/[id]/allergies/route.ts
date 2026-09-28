/**
 * /api/crm/patients/[id]/allergies — list + create.
 *
 * Allergies are clinic-scoped patient-attached records visible to every
 * tenant role (ADMIN/RECEPTIONIST/DOCTOR/NURSE/CALL_OPERATOR). Writes are
 * restricted to ADMIN, DOCTOR and NURSE — receptionists and call operators
 * do not amend medical history. Unlike diagnoses and chronic conditions
 * (clinical roles only since audit PT-11), the list stays open to everyone:
 * an allergy is a safety flag the front desk may need to see.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";
import { publishMedicalRecordChanged } from "@/server/patient/medical-record-events";

const SeveritySchema = z.enum(["MILD", "MODERATE", "SEVERE"]);

export const CreateAllergySchema = z.object({
  substance: z.string().min(1).max(120),
  reaction: z.string().max(240).nullish(),
  severity: SeveritySchema.default("MILD"),
  notes: z.string().max(2000).nullish(),
  recordedAt: z.coerce.date().nullish(),
});

function patientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/[id]/allergies → id at -2
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const patientId = patientIdFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) return notFound();
    const rows = await prisma.patientAllergy.findMany({
      where: { patientId },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    });
    return ok({ rows });
  },
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR", "NURSE"],
    bodySchema: CreateAllergySchema,
  },
  async ({ request, body, ctx }) => {
    const patientId = patientIdFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, clinicId: true },
    });
    if (!patient) return notFound();
    // Announced in the same transaction (audit G3-02): the doctor's open
    // drug check must see a new allergy without a reload.
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.patientAllergy.create({
        data: {
          clinicId: patient.clinicId,
          patientId,
          substance: body.substance,
          reaction: body.reaction ?? null,
          severity: body.severity,
          notes: body.notes ?? null,
          recordedAt: body.recordedAt ?? null,
        },
      });
      await publishMedicalRecordChanged(tx, {
        ctx: ctx.kind === "TENANT" ? ctx : null,
        clinicId: patient.clinicId,
        payload: { patientId, record: "allergy", action: "created", entityId: created.id },
      });
      return created;
    });
    await audit(request, {
      action: "patient.allergy.create",
      entityType: "PatientAllergy",
      entityId: row.id,
      meta: { patientId, substance: row.substance, severity: row.severity },
    });
    return ok(row, 201);
  },
);
