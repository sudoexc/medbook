/**
 * /api/crm/patients/[id]/diagnoses/[diagnosisId] — patch + delete.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err } from "@/server/http";

const StatusSchema = z.enum(["ACTIVE", "RESOLVED"]);

export const UpdateDiagnosisSchema = z.object({
  icd10Code: z.string().max(16).nullish(),
  label: z.string().min(1).max(240).optional(),
  diagnosedAt: z.coerce.date().nullish(),
  notes: z.string().max(2000).nullish(),
  status: StatusSchema.optional(),
});

function idsFromUrl(request: Request): { patientId: string; diagnosisId: string } {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return {
    diagnosisId: parts[parts.length - 1] ?? "",
    patientId: parts[parts.length - 3] ?? "",
  };
}

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR", "NURSE"],
    bodySchema: UpdateDiagnosisSchema,
  },
  async ({ request, body }) => {
    const { diagnosisId, patientId } = idsFromUrl(request);
    const before = await prisma.patientDiagnosis.findUnique({
      where: { id: diagnosisId },
    });
    if (!before || before.patientId !== patientId) return notFound();

    const data: Record<string, unknown> = {};
    if (body.icd10Code !== undefined) data.icd10Code = body.icd10Code;
    if (body.label !== undefined) data.label = body.label;
    if (body.diagnosedAt !== undefined) data.diagnosedAt = body.diagnosedAt;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.status !== undefined) data.status = body.status;
    if (Object.keys(data).length === 0) return err("nothing_to_update", 400);

    const after = await prisma.patientDiagnosis.update({
      where: { id: diagnosisId },
      data,
    });
    await audit(request, {
      action: "patient.diagnosis.update",
      entityType: "PatientDiagnosis",
      entityId: diagnosisId,
      meta: { patientId, fields: Object.keys(data) },
    });
    return ok(after);
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request }) => {
    const { diagnosisId, patientId } = idsFromUrl(request);
    const row = await prisma.patientDiagnosis.findUnique({
      where: { id: diagnosisId },
    });
    if (!row || row.patientId !== patientId) return notFound();
    await prisma.patientDiagnosis.delete({ where: { id: diagnosisId } });
    await audit(request, {
      action: "patient.diagnosis.delete",
      entityType: "PatientDiagnosis",
      entityId: diagnosisId,
      meta: { patientId, label: row.label },
    });
    return ok({ id: diagnosisId, deleted: true });
  },
);
