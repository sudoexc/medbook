/**
 * /api/crm/sick-leaves — create + list sick-leave certificates (Phase G7).
 *
 * Same patient/doctor anti-leak gate as LabOrder + EPrescription. The
 * `periodFrom`/`periodTo` columns are DATE (not timestamptz) — sick leave
 * is whole-day granularity.
 *
 * Audit: `SICK_LEAVE_ISSUED`. SSE: `sickleave.issued`.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
import { ok, err, parseQuery } from "@/server/http";
import {
  CreateSickLeaveSchema,
  QuerySickLeavesSchema,
} from "@/server/schemas/clinical-forms";
import {
  newVerifyToken,
  nextSickLeaveNumber,
} from "@/server/clinical-forms/numbering";

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: CreateSickLeaveSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const periodFrom = new Date(`${body.periodFrom}T00:00:00.000Z`);
    const periodTo = new Date(`${body.periodTo}T00:00:00.000Z`);
    if (periodTo < periodFrom) {
      return err("BadRequest", 400, { reason: "period_inverted" });
    }
    const days =
      Math.round((periodTo.getTime() - periodFrom.getTime()) / 86400000) + 1;
    if (days > 365) {
      return err("BadRequest", 400, { reason: "period_too_long" });
    }

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, signatureUrl: true },
    });
    if (!doctor) {
      return err("Forbidden", 403, { reason: "no_doctor_row_for_user" });
    }

    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId },
      select: { id: true },
    });
    if (!patient) return err("BadRequest", 400, { reason: "patient_not_found" });

    const hasRelationship = await prisma.appointment.findFirst({
      where: { patientId: body.patientId, doctorId: doctor.id },
      select: { id: true },
    });
    if (!hasRelationship) {
      return err("Forbidden", 403, { reason: "no_appointments_with_doctor" });
    }

    if (body.appointmentId) {
      const exists = await prisma.appointment.findFirst({
        where: {
          id: body.appointmentId,
          doctorId: doctor.id,
          patientId: body.patientId,
        },
        select: { id: true },
      });
      if (!exists) return err("BadRequest", 400, { reason: "appointment_mismatch" });
    }
    if (body.visitNoteId) {
      const exists = await prisma.visitNote.findFirst({
        where: {
          id: body.visitNoteId,
          doctorId: doctor.id,
          patientId: body.patientId,
        },
        select: { id: true },
      });
      if (!exists) return err("BadRequest", 400, { reason: "visit_note_mismatch" });
    }

    const certNumber = await nextSickLeaveNumber(ctx.clinicId);
    const verifyToken = newVerifyToken();

    const created = await prisma.sickLeave.create({
      data: {
        certNumber,
        verifyToken,
        clinicId: ctx.clinicId,
        patientId: body.patientId,
        doctorId: ctx.userId,
        appointmentId: body.appointmentId ?? null,
        visitNoteId: body.visitNoteId ?? null,
        diagnosisCode: body.diagnosisCode ?? null,
        diagnosisName: body.diagnosisName ?? null,
        signatureUrl: doctor.signatureUrl ?? null,
        regimen: body.regimen,
        periodFrom,
        periodTo,
        restrictions: body.restrictions ?? null,
        notes: body.notes ?? null,
        status: "ISSUED",
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.SICK_LEAVE_ISSUED,
      entityType: "SickLeave",
      entityId: created.id,
      meta: {
        doctorId: ctx.userId,
        patientId: created.patientId,
        certNumber: created.certNumber,
        regimen: created.regimen,
        periodFrom: body.periodFrom,
        periodTo: body.periodTo,
        days,
        diagnosisCode: body.diagnosisCode ?? null,
      },
    });

    publishEventSafe(ctx.clinicId, {
      type: "sickleave.issued",
      payload: {
        sickLeaveId: created.id,
        certNumber: created.certNumber,
        doctorId: ctx.userId,
        patientId: created.patientId,
        days,
      },
    });

    return ok(serialize(created), 201);
  },
);

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QuerySickLeavesSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = { clinicId: ctx.clinicId };
    if (q.patientId) where.patientId = q.patientId;
    if (q.visitNoteId) where.visitNoteId = q.visitNoteId;
    if (q.status) where.status = q.status;
    if (ctx.role === "DOCTOR") where.doctorId = ctx.userId;

    const rows = await prisma.sickLeave.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });

    return ok({ rows: rows.map(serialize), total: rows.length });
  },
);

type SickLeaveRow = {
  id: string;
  certNumber: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  visitNoteId: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  regimen: "OUTPATIENT" | "HOSPITAL" | "HOME";
  periodFrom: Date;
  periodTo: Date;
  restrictions: string | null;
  notes: string | null;
  issuedAt: Date;
  printedAt: Date | null;
  status: "ISSUED" | "CANCELLED";
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
};

function serialize(row: SickLeaveRow) {
  return {
    id: row.id,
    certNumber: row.certNumber,
    patientId: row.patientId,
    doctorId: row.doctorId,
    appointmentId: row.appointmentId,
    visitNoteId: row.visitNoteId,
    diagnosisCode: row.diagnosisCode,
    diagnosisName: row.diagnosisName,
    regimen: row.regimen,
    periodFrom: dateOnly(row.periodFrom),
    periodTo: dateOnly(row.periodTo),
    restrictions: row.restrictions,
    notes: row.notes,
    issuedAt: row.issuedAt.toISOString(),
    printedAt: row.printedAt ? row.printedAt.toISOString() : null,
    status: row.status,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  };
}

function dateOnly(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
