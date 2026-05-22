/**
 * /api/crm/cds-overrides — record + list CDS warning overrides (Phase G8).
 *
 * POST: doctor confirms they are knowingly keeping a prescription despite a
 * flagged CDS warning. The warning's snapshot (kind, severity, title, detail)
 * is stored on the row so the audit trail remains intact even after the live
 * CDS engine evolves. Reason is required — the picker enforces one of
 * `CdsOverrideReason`.
 *
 * Same anti-leak gate as G7: the patient must already be tied to this doctor
 * via an Appointment row.
 *
 * Audit: `CDS_OVERRIDE_RECORDED`. SSE: `cds.override.recorded`.
 *
 * GET: ADMIN/NURSE see all clinic rows; DOCTOR sees only their own. Useful
 * for the analytics dashboard ("how many overrides this month") and for
 * quality-team review.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
import { ok, err, parseQuery } from "@/server/http";
import {
  CreateCdsOverrideSchema,
  QueryCdsOverridesSchema,
} from "@/server/schemas/cds-overrides";

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: CreateCdsOverrideSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("Forbidden", 403, { reason: "no_doctor_row_for_user" });
    }

    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, clinicId: ctx.clinicId },
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

    const created = await prisma.cdsOverride.create({
      data: {
        clinicId: ctx.clinicId,
        doctorId: ctx.userId,
        patientId: body.patientId,
        appointmentId: body.appointmentId ?? null,
        visitNoteId: body.visitNoteId ?? null,
        warningKind: body.warningKind,
        severity: body.severity,
        warningTitle: body.warningTitle,
        warningDetail: body.warningDetail,
        warningKey: body.warningKey ?? null,
        reason: body.reason,
        reasonNote: body.reasonNote ?? null,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.CDS_OVERRIDE_RECORDED,
      entityType: "CdsOverride",
      entityId: created.id,
      meta: {
        doctorId: ctx.userId,
        patientId: created.patientId,
        appointmentId: created.appointmentId,
        visitNoteId: created.visitNoteId,
        warningKind: created.warningKind,
        severity: created.severity,
        warningKey: created.warningKey,
        reason: created.reason,
      },
    });

    publishEventSafe(ctx.clinicId, {
      type: "cds.override.recorded",
      payload: {
        overrideId: created.id,
        doctorId: ctx.userId,
        patientId: created.patientId,
        warningKind: created.warningKind,
        severity: created.severity,
        reason: created.reason,
      },
    });

    return ok(serialize(created), 201);
  },
);

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QueryCdsOverridesSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = { clinicId: ctx.clinicId };
    if (q.patientId) where.patientId = q.patientId;
    if (q.visitNoteId) where.visitNoteId = q.visitNoteId;
    if (q.doctorId) where.doctorId = q.doctorId;
    if (ctx.role === "DOCTOR") where.doctorId = ctx.userId;
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lte = new Date(q.to);
      where.createdAt = range;
    }

    const rows = await prisma.cdsOverride.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });

    return ok({ rows: rows.map(serialize), total: rows.length });
  },
);

type CdsOverrideRow = {
  id: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  appointmentId: string | null;
  visitNoteId: string | null;
  warningKind: string;
  severity: string;
  warningTitle: string;
  warningDetail: string;
  warningKey: string | null;
  reason: string;
  reasonNote: string | null;
  createdAt: Date;
};

function serialize(row: CdsOverrideRow) {
  return {
    id: row.id,
    doctorId: row.doctorId,
    patientId: row.patientId,
    appointmentId: row.appointmentId,
    visitNoteId: row.visitNoteId,
    warningKind: row.warningKind,
    severity: row.severity,
    warningTitle: row.warningTitle,
    warningDetail: row.warningDetail,
    warningKey: row.warningKey,
    reason: row.reason,
    reasonNote: row.reasonNote,
    createdAt: row.createdAt.toISOString(),
  };
}
