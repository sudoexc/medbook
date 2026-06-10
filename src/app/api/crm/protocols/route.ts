/**
 * /api/crm/protocols — manage clinic/personal clinical protocols (Ф3,
 * TZ-smart-constructor).
 *
 * GET  — rows the caller manages: DOCTOR → own personal protocols,
 *        ADMIN → clinic-own (doctorId null). Global seed rows are
 *        read-only and never appear here (apply-time lookup lives in
 *        /api/crm/catalogs/protocols).
 * POST — create in the caller's scope. DOCTOR → personal (clinicId +
 *        doctorId set, «сохранить приём как протокол»), ADMIN → clinic.
 *
 * ClinicalProtocol is in MODELS_WITHOUT_TENANT (nullable clinicId,
 * cross-tenant global rows) — every filter here is explicit and mandatory.
 */
import { Prisma } from "@/generated/prisma/client";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, forbidden } from "@/server/http";
import { CreateProtocolSchema } from "@/server/schemas/protocol";

async function myDoctorId(userId: string): Promise<string | null> {
  const doctor = await prisma.doctor.findFirst({
    where: { userId },
    select: { id: true },
  });
  return doctor?.id ?? null;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();

    if (ctx.role === "DOCTOR") {
      const doctorId = await myDoctorId(ctx.userId);
      if (!doctorId) return ok({ rows: [], total: 0 });
      const rows = await prisma.clinicalProtocol.findMany({
        where: { clinicId: ctx.clinicId, doctorId },
        orderBy: [{ diagnosisCodePrefix: "asc" }, { sortOrder: "asc" }],
      });
      return ok({ rows, total: rows.length });
    }

    const rows = await prisma.clinicalProtocol.findMany({
      where: { clinicId: ctx.clinicId, doctorId: null },
      orderBy: [{ diagnosisCodePrefix: "asc" }, { sortOrder: "asc" }],
    });
    return ok({ rows, total: rows.length });
  },
);

export const POST = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"], bodySchema: CreateProtocolSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();

    let doctorId: string | null = null;
    if (ctx.role === "DOCTOR") {
      doctorId = await myDoctorId(ctx.userId);
      if (!doctorId) return err("No doctor profile", 409);
    }

    const row = await prisma.clinicalProtocol.create({
      data: {
        clinicId: ctx.clinicId,
        doctorId,
        diagnosisCodePrefix: body.diagnosisCodePrefix.trim().toUpperCase(),
        nameRu: body.nameRu.trim(),
        nameUz: body.nameUz?.trim() || null,
        summaryRu: body.summaryRu?.trim() || null,
        complaintsTemplate: body.complaintsTemplate,
        anamnesisTemplate: body.anamnesisTemplate,
        examinationTemplate: body.examinationTemplate,
        prescriptionsTemplate: body.prescriptionsTemplate,
        prescriptionItems:
          body.prescriptionItems.length > 0
            ? (body.prescriptionItems as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        adviceTemplate: body.adviceTemplate,
        recommendedLabs: body.recommendedLabs,
        conclusionTemplateMd: body.conclusionTemplateMd?.trim() || null,
        guideCode: body.guideCode?.trim() || null,
        followUpDays: body.followUpDays ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });

    await audit(request, {
      action: "protocol.create",
      entityType: "ClinicalProtocol",
      entityId: row.id,
      meta: {
        scope: doctorId ? "PERSONAL" : "CLINIC",
        diagnosisCodePrefix: row.diagnosisCodePrefix,
        items: body.prescriptionItems.length,
      },
    });

    return ok(row, 201);
  },
);
