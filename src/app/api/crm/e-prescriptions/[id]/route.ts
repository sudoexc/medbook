/**
 * /api/crm/e-prescriptions/[id] — single Rx detail + cancellation.
 *
 * GET: denormalised view (patient, doctor, clinic) for the print preview
 * and history drawer.
 *
 * PATCH: only path is "cancel with reason" — the issued recipe is immutable
 * by design; if the doctor needs different items they cancel + reissue. The
 * cancellation row keeps the verify token working but flips the public
 * verify page to "CANCELLED" so a pharmacy can refuse it.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
import { ok, err } from "@/server/http";
import { CancelEPrescriptionSchema } from "@/server/schemas/clinical-forms";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request.url);
    if (!id) return err("BadRequest", 400);

    const rx = await prisma.ePrescription.findFirst({
      where: { id, clinicId: ctx.clinicId },
      include: {
        patient: {
          select: {
            id: true,
            fullName: true,
            birthDate: true,
            gender: true,
            phoneNormalized: true,
          },
        },
        doctor: { select: { id: true, name: true, phone: true } },
        clinic: {
          select: {
            id: true,
            nameRu: true,
            phone: true,
            addressRu: true,
            logoUrl: true,
          },
        },
      },
    });
    if (!rx) return err("NotFound", 404);
    if (ctx.role === "DOCTOR" && rx.doctorId !== ctx.userId) {
      return err("Forbidden", 403);
    }

    return ok({
      id: rx.id,
      rxNumber: rx.rxNumber,
      patient: rx.patient,
      doctor: rx.doctor,
      clinic: rx.clinic,
      appointmentId: rx.appointmentId,
      visitNoteId: rx.visitNoteId,
      diagnosisCode: rx.diagnosisCode,
      diagnosisName: rx.diagnosisName,
      items: rx.items,
      notes: rx.notes,
      issuedAt: rx.issuedAt.toISOString(),
      validUntilAt: rx.validUntilAt.toISOString(),
      printedAt: rx.printedAt ? rx.printedAt.toISOString() : null,
      status: rx.status,
      cancelledAt: rx.cancelledAt ? rx.cancelledAt.toISOString() : null,
      cancelReason: rx.cancelReason,
    });
  },
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"], bodySchema: CancelEPrescriptionSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request.url);
    if (!id) return err("BadRequest", 400);

    const existing = await prisma.ePrescription.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, doctorId: true, status: true, rxNumber: true },
    });
    if (!existing) return err("NotFound", 404);
    if (ctx.role === "DOCTOR" && existing.doctorId !== ctx.userId) {
      return err("Forbidden", 403);
    }
    if (existing.status === "CANCELLED") {
      return err("BadRequest", 400, { reason: "already_cancelled" });
    }

    const updated = await prisma.ePrescription.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: ctx.userId,
        cancelReason: body.cancelReason,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.EPRESCRIPTION_CANCELLED,
      entityType: "EPrescription",
      entityId: id,
      meta: { rxNumber: existing.rxNumber, reason: body.cancelReason },
    });

    publishEventSafe(ctx.clinicId, {
      type: "eprescription.cancelled",
      payload: { ePrescriptionId: id, rxNumber: existing.rxNumber },
    });

    return ok({
      id: updated.id,
      status: updated.status,
      cancelledAt: updated.cancelledAt ? updated.cancelledAt.toISOString() : null,
    });
  },
);

function idFromUrl(url: string): string | null {
  const m = /\/e-prescriptions\/([^/?]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}
