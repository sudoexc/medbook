/**
 * /api/crm/patients/[id]/chronic-conditions — list + create.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";
import { publishMedicalRecordChanged } from "@/server/patient/medical-record-events";

export const CreateChronicSchema = z.object({
  name: z.string().min(1).max(240),
  sinceDate: z.coerce.date().nullish(),
  notes: z.string().max(2000).nullish(),
  isActive: z.boolean().default(true),
});

function patientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

// Clinical roles only (audit PT-11): the «Медицина» tab is hidden from the
// front desk and the call center, and the API no longer answers them
// either. Allergies stay readable by every role: a safety flag.
export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request }) => {
    const patientId = patientIdFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) return notFound();
    const rows = await prisma.patientChronicCondition.findMany({
      where: { patientId },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    });
    return ok({ rows });
  },
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR", "NURSE"],
    bodySchema: CreateChronicSchema,
  },
  async ({ request, body, ctx }) => {
    const patientId = patientIdFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, clinicId: true },
    });
    if (!patient) return notFound();
    // Announced in the same transaction (audit G3-02): chronic conditions
    // feed the doctor's contraindication check.
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.patientChronicCondition.create({
        data: {
          clinicId: patient.clinicId,
          patientId,
          name: body.name,
          sinceDate: body.sinceDate ?? null,
          notes: body.notes ?? null,
          isActive: body.isActive,
        },
      });
      await publishMedicalRecordChanged(tx, {
        ctx: ctx.kind === "TENANT" ? ctx : null,
        clinicId: patient.clinicId,
        payload: { patientId, record: "chronic", action: "created", entityId: created.id },
      });
      return created;
    });
    await audit(request, {
      action: "patient.chronic.create",
      entityType: "PatientChronicCondition",
      entityId: row.id,
      meta: { patientId, name: row.name },
    });
    return ok(row, 201);
  },
);
