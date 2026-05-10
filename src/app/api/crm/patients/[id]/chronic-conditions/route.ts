/**
 * /api/crm/patients/[id]/chronic-conditions — list + create.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";

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

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
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
  async ({ request, body }) => {
    const patientId = patientIdFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, clinicId: true },
    });
    if (!patient) return notFound();
    const row = await prisma.patientChronicCondition.create({
      data: {
        clinicId: patient.clinicId,
        patientId,
        name: body.name,
        sinceDate: body.sinceDate ?? null,
        notes: body.notes ?? null,
        isActive: body.isActive,
      },
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
