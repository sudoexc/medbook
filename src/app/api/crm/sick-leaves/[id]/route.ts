/**
 * /api/crm/sick-leaves/[id] — single certificate detail + cancellation.
 *
 * Mirrors the EPrescription PATCH-only cancel pattern. ADMIN can cancel
 * any clinic certificate; DOCTOR can only cancel their own.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
import { ok, err } from "@/server/http";
import { CancelSickLeaveSchema } from "@/server/schemas/clinical-forms";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request.url);
    if (!id) return err("BadRequest", 400);

    const sl = await prisma.sickLeave.findFirst({
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
    if (!sl) return err("NotFound", 404);
    if (ctx.role === "DOCTOR" && sl.doctorId !== ctx.userId) {
      return err("Forbidden", 403);
    }

    return ok({
      id: sl.id,
      certNumber: sl.certNumber,
      patient: sl.patient,
      doctor: sl.doctor,
      clinic: sl.clinic,
      appointmentId: sl.appointmentId,
      visitNoteId: sl.visitNoteId,
      diagnosisCode: sl.diagnosisCode,
      diagnosisName: sl.diagnosisName,
      regimen: sl.regimen,
      periodFrom: dateOnly(sl.periodFrom),
      periodTo: dateOnly(sl.periodTo),
      restrictions: sl.restrictions,
      notes: sl.notes,
      issuedAt: sl.issuedAt.toISOString(),
      printedAt: sl.printedAt ? sl.printedAt.toISOString() : null,
      status: sl.status,
      cancelledAt: sl.cancelledAt ? sl.cancelledAt.toISOString() : null,
      cancelReason: sl.cancelReason,
    });
  },
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"], bodySchema: CancelSickLeaveSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request.url);
    if (!id) return err("BadRequest", 400);

    const existing = await prisma.sickLeave.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, doctorId: true, status: true, certNumber: true },
    });
    if (!existing) return err("NotFound", 404);
    if (ctx.role === "DOCTOR" && existing.doctorId !== ctx.userId) {
      return err("Forbidden", 403);
    }
    if (existing.status === "CANCELLED") {
      return err("BadRequest", 400, { reason: "already_cancelled" });
    }

    const updated = await prisma.sickLeave.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: ctx.userId,
        cancelReason: body.cancelReason,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.SICK_LEAVE_CANCELLED,
      entityType: "SickLeave",
      entityId: id,
      meta: { certNumber: existing.certNumber, reason: body.cancelReason },
    });

    publishEventSafe(ctx.clinicId, {
      type: "sickleave.cancelled",
      payload: { sickLeaveId: id, certNumber: existing.certNumber },
    });

    return ok({
      id: updated.id,
      status: updated.status,
      cancelledAt: updated.cancelledAt ? updated.cancelledAt.toISOString() : null,
    });
  },
);

function idFromUrl(url: string): string | null {
  const m = /\/sick-leaves\/([^/?]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

function dateOnly(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
