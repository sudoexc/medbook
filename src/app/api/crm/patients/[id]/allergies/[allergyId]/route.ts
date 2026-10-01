/**
 * /api/crm/patients/[id]/allergies/[allergyId] — patch + delete.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err } from "@/server/http";
import { publishMedicalRecordChanged } from "@/server/patient/medical-record-events";
import {
  medicalRecordDeleteAuditMeta,
  medicalRecordUpdateAuditMeta,
} from "@/server/audit/patient-audit-meta";

const SeveritySchema = z.enum(["MILD", "MODERATE", "SEVERE"]);

export const UpdateAllergySchema = z.object({
  substance: z.string().min(1).max(120).optional(),
  reaction: z.string().max(240).nullish(),
  severity: SeveritySchema.optional(),
  notes: z.string().max(2000).nullish(),
  recordedAt: z.coerce.date().nullish(),
});

function idsFromUrl(request: Request): { patientId: string; allergyId: string } {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/[id]/allergies/[allergyId]
  return {
    allergyId: parts[parts.length - 1] ?? "",
    patientId: parts[parts.length - 3] ?? "",
  };
}

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR", "NURSE"],
    bodySchema: UpdateAllergySchema,
  },
  async ({ request, body, ctx }) => {
    const { allergyId, patientId } = idsFromUrl(request);
    const before = await prisma.patientAllergy.findUnique({ where: { id: allergyId } });
    if (!before || before.patientId !== patientId) return notFound();

    const data: Record<string, unknown> = {};
    if (body.substance !== undefined) data.substance = body.substance;
    if (body.reaction !== undefined) data.reaction = body.reaction;
    if (body.severity !== undefined) data.severity = body.severity;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.recordedAt !== undefined) data.recordedAt = body.recordedAt;
    if (Object.keys(data).length === 0) {
      return err("nothing_to_update", 400);
    }

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.patientAllergy.update({
        where: { id: allergyId },
        data,
      });
      await publishMedicalRecordChanged(tx, {
        ctx: ctx.kind === "TENANT" ? ctx : null,
        clinicId: before.clinicId,
        payload: { patientId, record: "allergy", action: "updated", entityId: allergyId },
      });
      return updated;
    });
    await audit(request, {
      action: "patient.allergy.update",
      entityType: "PatientAllergy",
      entityId: allergyId,
      // Old and new values, not just field names (audit G1-07).
      meta: medicalRecordUpdateAuditMeta(patientId, before, after),
    });
    return ok(after);
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    const { allergyId, patientId } = idsFromUrl(request);
    const row = await prisma.patientAllergy.findUnique({ where: { id: allergyId } });
    if (!row || row.patientId !== patientId) return notFound();
    await prisma.$transaction(async (tx) => {
      await tx.patientAllergy.delete({ where: { id: allergyId } });
      await publishMedicalRecordChanged(tx, {
        ctx: ctx.kind === "TENANT" ? ctx : null,
        clinicId: row.clinicId,
        payload: { patientId, record: "allergy", action: "deleted", entityId: allergyId },
      });
    });
    await audit(request, {
      action: "patient.allergy.delete",
      entityType: "PatientAllergy",
      entityId: allergyId,
      // The whole removed row, so it can be restored (audit G1-07).
      meta: medicalRecordDeleteAuditMeta(patientId, row),
    });
    return ok({ id: allergyId, deleted: true });
  },
);
