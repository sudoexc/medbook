/**
 * POST /api/crm/action-center/mark-contacted
 *
 * Receptionist clicked "Обработано" on a risk-today row whose only signal
 * was `no_contact` (no detector Action attached). Stamps the patient's
 * `lastContactedAt = now()` so the row drops off the next risk-today
 * refetch instead of resurrecting itself.
 *
 * Body: `{ patientId, appointmentId? }`. `appointmentId` is optional and
 * only used for the audit row (lets support trace which row triggered the
 * stamp).
 *
 * Without this endpoint the client used to just invalidate the cache,
 * which fetched the same row right back because nothing on the server
 * changed.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";
import { err, notFound, ok } from "@/server/http";

const Body = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1).optional(),
});

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: Body,
  },
  async ({ body, request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);

    const patient = await prisma.patient.findUnique({
      where: { id: body.patientId },
      select: { id: true, clinicId: true },
    });
    if (!patient || patient.clinicId !== ctx.clinicId) return notFound();

    const at = new Date();
    await bumpPatientLastContact(patient.id, at);

    await audit(request, {
      action: AUDIT_ACTION.PATIENT_CONTACT_MARKED,
      entityType: "Patient",
      entityId: patient.id,
      meta: {
        appointmentId: body.appointmentId ?? null,
        surface: "action-center.risk-today",
        at: at.toISOString(),
      },
    });

    return ok({ patientId: patient.id, lastContactedAt: at.toISOString() });
  },
);
