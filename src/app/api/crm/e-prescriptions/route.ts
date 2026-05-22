/**
 * /api/crm/e-prescriptions — create + list electronic prescriptions (Phase G7).
 *
 * POST: doctor issues an Rx during a visit. The patient must be tied to the
 * doctor via an Appointment row (same anti-leak gate as LabOrder). Items are
 * snapshotted into the JSONB column so future catalog edits don't mutate
 * already-issued recipes. `signatureUrl` snapshots the doctor's wet signature
 * at issue time too — printing a year later still shows the correct sig.
 *
 * `rxNumber` is computed server-side as `RX-YYYYMMDD-NNNN`. `verifyToken` is
 * a random base64url string embedded in the QR; anyone with the printout
 * can verify the recipe is real via `/api/verify/recipe/[token]` without
 * needing CRM credentials.
 *
 * Audit: `EPRESCRIPTION_ISSUED`. SSE: `eprescription.issued`.
 *
 * GET: ADMIN sees all clinic rows; DOCTOR sees only their own.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
import { ok, err, parseQuery } from "@/server/http";
import {
  CreateEPrescriptionSchema,
  QueryEPrescriptionsSchema,
} from "@/server/schemas/clinical-forms";
import {
  newVerifyToken,
  nextRxNumber,
} from "@/server/clinical-forms/numbering";

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: CreateEPrescriptionSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

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

    const issuedAt = new Date();
    const validUntilAt = new Date(
      issuedAt.getTime() + body.validForDays * 24 * 60 * 60 * 1000,
    );
    const rxNumber = await nextRxNumber(ctx.clinicId);
    const verifyToken = newVerifyToken();

    const created = await prisma.ePrescription.create({
      data: {
        rxNumber,
        verifyToken,
        clinicId: ctx.clinicId,
        patientId: body.patientId,
        doctorId: ctx.userId,
        appointmentId: body.appointmentId ?? null,
        visitNoteId: body.visitNoteId ?? null,
        diagnosisCode: body.diagnosisCode ?? null,
        diagnosisName: body.diagnosisName ?? null,
        signatureUrl: doctor.signatureUrl ?? null,
        items: body.items,
        notes: body.notes ?? null,
        issuedAt,
        validUntilAt,
        status: "ISSUED",
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.EPRESCRIPTION_ISSUED,
      entityType: "EPrescription",
      entityId: created.id,
      meta: {
        doctorId: ctx.userId,
        patientId: created.patientId,
        rxNumber: created.rxNumber,
        itemCount: body.items.length,
        diagnosisCode: body.diagnosisCode ?? null,
        validForDays: body.validForDays,
      },
    });

    publishEventSafe(ctx.clinicId, {
      type: "eprescription.issued",
      payload: {
        ePrescriptionId: created.id,
        rxNumber: created.rxNumber,
        doctorId: ctx.userId,
        patientId: created.patientId,
        itemCount: body.items.length,
      },
    });

    return ok(serialize(created), 201);
  },
);

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QueryEPrescriptionsSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = { clinicId: ctx.clinicId };
    if (q.patientId) where.patientId = q.patientId;
    if (q.visitNoteId) where.visitNoteId = q.visitNoteId;
    if (q.status) where.status = q.status;
    if (ctx.role === "DOCTOR") where.doctorId = ctx.userId;

    const rows = await prisma.ePrescription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });

    return ok({ rows: rows.map(serialize), total: rows.length });
  },
);

type EPrescriptionRow = {
  id: string;
  rxNumber: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  visitNoteId: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  items: unknown;
  notes: string | null;
  issuedAt: Date;
  validUntilAt: Date;
  printedAt: Date | null;
  status: "ISSUED" | "CANCELLED";
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
};

function serialize(row: EPrescriptionRow) {
  return {
    id: row.id,
    rxNumber: row.rxNumber,
    patientId: row.patientId,
    doctorId: row.doctorId,
    appointmentId: row.appointmentId,
    visitNoteId: row.visitNoteId,
    diagnosisCode: row.diagnosisCode,
    diagnosisName: row.diagnosisName,
    items: row.items,
    notes: row.notes,
    issuedAt: row.issuedAt.toISOString(),
    validUntilAt: row.validUntilAt.toISOString(),
    printedAt: row.printedAt ? row.printedAt.toISOString() : null,
    status: row.status,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  };
}
