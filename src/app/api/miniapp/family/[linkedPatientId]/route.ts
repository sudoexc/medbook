/**
 * Phase 16 Wave 1 — DELETE /api/miniapp/family/[linkedPatientId]
 *
 * Unlinks a relative from the authenticated owner. Drops the
 * `PatientFamily` row only — the linked Patient row stays intact (and so
 * do their appointments / cases / payments). The relative is simply no
 * longer accessible from the owner's TG family switcher.
 */
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { notFound, ok } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";

function linkedPatientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const DELETE = createMiniAppHandler({}, async ({ request, ctx }) => {
  const linkedPatientId = linkedPatientIdFromUrl(request);
  const link = await prisma.patientFamily.findFirst({
    where: {
      clinicId: ctx.clinicId,
      ownerPatientId: ctx.patientId,
      linkedPatientId,
    },
    select: { id: true, relationship: true, linkedPatientId: true },
  });
  if (!link) return notFound();

  await prisma.patientFamily.delete({ where: { id: link.id } });

  await audit(request, {
    action: AUDIT_ACTION.PATIENT_FAMILY_UNLINKED,
    entityType: "PatientFamily",
    entityId: link.id,
    meta: {
      ownerPatientId: ctx.patientId,
      linkedPatientId: link.linkedPatientId,
      relationship: link.relationship,
    },
  });

  return ok({ ok: true });
});
