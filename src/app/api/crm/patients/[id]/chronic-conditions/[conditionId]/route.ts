/**
 * /api/crm/patients/[id]/chronic-conditions/[conditionId] — patch + delete.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, err } from "@/server/http";

export const UpdateChronicSchema = z.object({
  name: z.string().min(1).max(240).optional(),
  sinceDate: z.coerce.date().nullish(),
  notes: z.string().max(2000).nullish(),
  isActive: z.boolean().optional(),
});

function idsFromUrl(request: Request): { patientId: string; conditionId: string } {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return {
    conditionId: parts[parts.length - 1] ?? "",
    patientId: parts[parts.length - 3] ?? "",
  };
}

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR", "NURSE"],
    bodySchema: UpdateChronicSchema,
  },
  async ({ request, body }) => {
    const { conditionId, patientId } = idsFromUrl(request);
    const before = await prisma.patientChronicCondition.findUnique({
      where: { id: conditionId },
    });
    if (!before || before.patientId !== patientId) return notFound();

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.sinceDate !== undefined) data.sinceDate = body.sinceDate;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (Object.keys(data).length === 0) return err("nothing_to_update", 400);

    const after = await prisma.patientChronicCondition.update({
      where: { id: conditionId },
      data,
    });
    await audit(request, {
      action: "patient.chronic.update",
      entityType: "PatientChronicCondition",
      entityId: conditionId,
      meta: { patientId, fields: Object.keys(data) },
    });
    return ok(after);
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request }) => {
    const { conditionId, patientId } = idsFromUrl(request);
    const row = await prisma.patientChronicCondition.findUnique({
      where: { id: conditionId },
    });
    if (!row || row.patientId !== patientId) return notFound();
    await prisma.patientChronicCondition.delete({ where: { id: conditionId } });
    await audit(request, {
      action: "patient.chronic.delete",
      entityType: "PatientChronicCondition",
      entityId: conditionId,
      meta: { patientId, name: row.name },
    });
    return ok({ id: conditionId, deleted: true });
  },
);
