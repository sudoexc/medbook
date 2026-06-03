/**
 * Phase 16 Wave 1 — DELETE /api/miniapp/family/[linkedPatientId]
 *
 * Unlinks a relative from the authenticated owner. Drops the
 * `PatientFamily` row only — the linked Patient row stays intact (and so
 * do their appointments / cases / payments). The relative is simply no
 * longer accessible from the owner's TG family switcher.
 *
 * Phase M2 — publishes `patient.familyUnlinked` via the outbox; the
 * pumper materialises the audit row from the envelope (auditable=true).
 */
import { prisma } from "@/lib/prisma";
import { notFound, ok } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

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

  await prisma.$transaction(async (tx) => {
    await tx.patientFamily.delete({ where: { id: link.id } });

    const envelope: EventEnvelopeInput = {
      correlationId: newCorrelationId(),
      actor: {
        role: "PATIENT",
        userId: null,
        patientId: ctx.patientId,
        onBehalfOfPatientId: null,
        label: `patient:${ctx.patientId}`,
      },
      surface: "MINIAPP",
      tenantScope: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
      },
      type: "patient.familyUnlinked",
      payload: {
        ownerPatientId: ctx.patientId,
        linkedPatientId: link.linkedPatientId,
        relationship: link.relationship,
      },
    };
    await publishViaOutbox(tx, envelope);
  });

  return ok({ ok: true });
});
