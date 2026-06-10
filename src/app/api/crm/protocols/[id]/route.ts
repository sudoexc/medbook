/**
 * /api/crm/protocols/[id] — PATCH update / soft-delete (active=false).
 *
 * Ownership gate (Ф3): DOCTOR edits only their own personal rows; ADMIN
 * edits clinic-own rows (doctorId null) of their clinic. Global seed rows
 * (clinicId null) are read-only here — clinics hide them via the catalog
 * overlay instead.
 */
import { Prisma } from "@/generated/prisma/client";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, forbidden, notFound } from "@/server/http";
import { UpdateProtocolSchema } from "@/server/schemas/protocol";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"], bodySchema: UpdateProtocolSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);

    const before = await prisma.clinicalProtocol.findUnique({ where: { id } });
    if (!before || before.clinicId !== ctx.clinicId) return notFound();

    if (ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor || before.doctorId !== doctor.id) return forbidden();
    } else if (before.doctorId !== null) {
      // ADMIN manages clinic-own rows only, not doctors' personal ones.
      return forbidden();
    }

    const data: Prisma.ClinicalProtocolUpdateInput = {};
    if (body.diagnosisCodePrefix !== undefined) {
      data.diagnosisCodePrefix = body.diagnosisCodePrefix.trim().toUpperCase();
    }
    if (body.nameRu !== undefined) data.nameRu = body.nameRu.trim();
    if (body.nameUz !== undefined) data.nameUz = body.nameUz?.trim() || null;
    if (body.summaryRu !== undefined) data.summaryRu = body.summaryRu?.trim() || null;
    if (body.complaintsTemplate !== undefined) data.complaintsTemplate = body.complaintsTemplate;
    if (body.anamnesisTemplate !== undefined) data.anamnesisTemplate = body.anamnesisTemplate;
    if (body.examinationTemplate !== undefined) data.examinationTemplate = body.examinationTemplate;
    if (body.prescriptionsTemplate !== undefined) data.prescriptionsTemplate = body.prescriptionsTemplate;
    if (body.prescriptionItems !== undefined) {
      data.prescriptionItems =
        body.prescriptionItems.length > 0
          ? (body.prescriptionItems as Prisma.InputJsonValue)
          : Prisma.JsonNull;
    }
    if (body.adviceTemplate !== undefined) data.adviceTemplate = body.adviceTemplate;
    if (body.recommendedLabs !== undefined) data.recommendedLabs = body.recommendedLabs;
    if (body.conclusionTemplateMd !== undefined) {
      data.conclusionTemplateMd = body.conclusionTemplateMd?.trim() || null;
    }
    if (body.guideCode !== undefined) data.guideCode = body.guideCode?.trim() || null;
    if (body.followUpDays !== undefined) data.followUpDays = body.followUpDays ?? null;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.active !== undefined) data.active = body.active;

    const row = await prisma.clinicalProtocol.update({ where: { id }, data });

    await audit(request, {
      action: "protocol.update",
      entityType: "ClinicalProtocol",
      entityId: id,
      meta: {
        scope: before.doctorId ? "PERSONAL" : "CLINIC",
        fields: Object.keys(data),
      },
    });

    return ok(row);
  },
);
