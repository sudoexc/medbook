/**
 * /api/crm/patients/[id]/diagnoses — list + create.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";

const StatusSchema = z.enum(["ACTIVE", "RESOLVED"]);

export const CreateDiagnosisSchema = z.object({
  icd10Code: z.string().max(16).nullish(),
  label: z.string().min(1).max(240),
  diagnosedAt: z.coerce.date().nullish(),
  notes: z.string().max(2000).nullish(),
  status: StatusSchema.default("ACTIVE"),
});

function patientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
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
    const rows = await prisma.patientDiagnosis.findMany({
      where: { patientId },
      orderBy: [{ status: "asc" }, { diagnosedAt: "desc" }, { createdAt: "desc" }],
    });
    return ok({ rows });
  },
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR", "NURSE"],
    bodySchema: CreateDiagnosisSchema,
  },
  async ({ request, body }) => {
    const patientId = patientIdFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, clinicId: true },
    });
    if (!patient) return notFound();
    const row = await prisma.patientDiagnosis.create({
      data: {
        clinicId: patient.clinicId,
        patientId,
        icd10Code: body.icd10Code ?? null,
        label: body.label,
        diagnosedAt: body.diagnosedAt ?? null,
        notes: body.notes ?? null,
        status: body.status,
      },
    });
    await audit(request, {
      action: "patient.diagnosis.create",
      entityType: "PatientDiagnosis",
      entityId: row.id,
      meta: { patientId, label: row.label, icd10Code: row.icd10Code },
    });
    return ok(row, 201);
  },
);
