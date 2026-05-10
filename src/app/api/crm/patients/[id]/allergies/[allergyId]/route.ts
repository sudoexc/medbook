/**
 * /api/crm/patients/[id]/allergies/[allergyId] — patch + delete.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err } from "@/server/http";

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
  async ({ request, body }) => {
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

    const after = await prisma.patientAllergy.update({
      where: { id: allergyId },
      data,
    });
    await audit(request, {
      action: "patient.allergy.update",
      entityType: "PatientAllergy",
      entityId: allergyId,
      meta: { patientId, fields: Object.keys(data) },
    });
    return ok(after);
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request }) => {
    const { allergyId, patientId } = idsFromUrl(request);
    const row = await prisma.patientAllergy.findUnique({ where: { id: allergyId } });
    if (!row || row.patientId !== patientId) return notFound();
    await prisma.patientAllergy.delete({ where: { id: allergyId } });
    await audit(request, {
      action: "patient.allergy.delete",
      entityType: "PatientAllergy",
      entityId: allergyId,
      meta: { patientId, substance: row.substance },
    });
    return ok({ id: allergyId, deleted: true });
  },
);
