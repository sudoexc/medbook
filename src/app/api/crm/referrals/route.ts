/**
 * /api/crm/referrals — create + list clinical referrals (направления). P2.1.
 *
 * POST (DOCTOR): a doctor sends a patient onward to an internal colleague
 * (`toDoctorId`) or an outside clinic/specialty (`externalTo`). Same anti-leak
 * gate as SickLeave/EPrescription: the author must already have an appointment
 * with the patient, and an internal target must be a DOCTOR in the same clinic.
 * `diagnosisCode/diagnosisName` are snapshotted from the request (the caller
 * passes the originating visit's ICD-10) so the referral can't drift if the
 * note is later re-coded. A REFERRAL Document PDF is rendered async by the
 * worker (P2.1d) and linked back via `Document.referralId`.
 *
 * GET (ADMIN/DOCTOR/NURSE): `?scope=incoming` (addressed to me) /
 * `?scope=outgoing` (authored by me); a doctor with no scope sees both sides,
 * admin/nurse see the whole clinic. Optional `patientId` + `status` filters.
 *
 * Audit: `REFERRAL_CREATED` (sole source — the `referral.created` SSE event is
 * non-auditable, mirroring `lab.result.reviewed`). SSE: `referral.created`
 * through the outbox (reaches the patient Mini App's documents refresh + the
 * target doctor's incoming queue).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import { ok, err, parseQuery } from "@/server/http";
import {
  CreateReferralSchema,
  QueryReferralsSchema,
} from "@/server/schemas/referrals";

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: CreateReferralSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    if (body.toDoctorId && body.toDoctorId === ctx.userId) {
      return err("BadRequest", 400, { reason: "self_referral" });
    }

    // The relationship gate is keyed on the Doctor row (Appointment.doctorId →
    // Doctor), while Referral.fromDoctorId stores the User id — same split as
    // SickLeave.
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

    // Internal target must be a DOCTOR in *this* clinic — never let a referral
    // address a user in another tenant.
    if (body.toDoctorId) {
      const target = await prisma.user.findFirst({
        where: { id: body.toDoctorId, clinicId: ctx.clinicId, role: "DOCTOR" },
        select: { id: true },
      });
      if (!target) {
        return err("BadRequest", 400, { reason: "target_doctor_not_found" });
      }
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
      if (!exists) {
        return err("BadRequest", 400, { reason: "visit_note_mismatch" });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.referral.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: body.patientId,
          fromDoctorId: ctx.userId,
          toDoctorId: body.toDoctorId ?? null,
          externalTo: body.externalTo ?? null,
          visitNoteId: body.visitNoteId ?? null,
          reason: body.reason,
          diagnosisCode: body.diagnosisCode ?? null,
          diagnosisName: body.diagnosisName ?? null,
          status: "PENDING",
        },
      });
      await publishViaOutbox(tx, {
        correlationId: newCorrelationId(),
        actor: {
          role: "DOCTOR",
          userId: ctx.userId,
          patientId: null,
          onBehalfOfPatientId: null,
          label: `user:${ctx.userId}`,
        },
        surface: "DOCTOR_CABINET",
        tenantScope: {
          clinicId: ctx.clinicId,
          patientId: row.patientId,
          doctorId: doctor.id,
        },
        type: "referral.created",
        payload: {
          referralId: row.id,
          fromDoctorId: ctx.userId,
          toDoctorId: row.toDoctorId,
          patientId: row.patientId,
        },
      });
      return row;
    });

    // Sole audit source — `referral.created` is non-auditable in
    // EVENT_META_OVERRIDES, so the pumper writes no row; this carries the
    // request IP/UA. Runs after commit so a rolled-back create leaves no
    // phantom audit row.
    await audit(request, {
      action: AUDIT_ACTION.REFERRAL_CREATED,
      entityType: "Referral",
      entityId: created.id,
      meta: {
        patientId: created.patientId,
        fromDoctorId: ctx.userId,
        toDoctorId: created.toDoctorId,
        externalTo: created.externalTo,
        visitNoteId: created.visitNoteId,
        diagnosisCode: created.diagnosisCode,
      },
    });

    return ok(serialize(created), 201);
  },
);

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QueryReferralsSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = { clinicId: ctx.clinicId };
    if (q.patientId) where.patientId = q.patientId;
    if (q.status) where.status = q.status;
    if (q.scope === "incoming") {
      where.toDoctorId = ctx.userId;
    } else if (q.scope === "outgoing") {
      where.fromDoctorId = ctx.userId;
    } else if (ctx.role === "DOCTOR") {
      // No scope + doctor → their own referrals on either side.
      where.OR = [{ fromDoctorId: ctx.userId }, { toDoctorId: ctx.userId }];
    }

    const rows = await prisma.referral.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit,
      select: {
        id: true,
        patientId: true,
        fromDoctorId: true,
        toDoctorId: true,
        externalTo: true,
        visitNoteId: true,
        reason: true,
        diagnosisCode: true,
        diagnosisName: true,
        status: true,
        scheduledAppointmentId: true,
        createdAt: true,
        updatedAt: true,
        patient: { select: { fullName: true } },
        // The Russian-only cabinet reads `nameRu`; fall back to the bare
        // User.name for a staff user without a Doctor profile.
        fromDoctor: { select: { name: true, doctor: { select: { nameRu: true } } } },
        toDoctor: { select: { name: true, doctor: { select: { nameRu: true } } } },
      },
    });

    return ok({ rows: rows.map(serializeRow), total: rows.length });
  },
);

type CreatedReferral = {
  id: string;
  patientId: string;
  fromDoctorId: string;
  toDoctorId: string | null;
  externalTo: string | null;
  visitNoteId: string | null;
  reason: string;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  status: "PENDING" | "SCHEDULED" | "COMPLETED" | "CANCELLED";
  scheduledAppointmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function serialize(row: CreatedReferral) {
  return {
    id: row.id,
    patientId: row.patientId,
    fromDoctorId: row.fromDoctorId,
    toDoctorId: row.toDoctorId,
    externalTo: row.externalTo,
    visitNoteId: row.visitNoteId,
    reason: row.reason,
    diagnosisCode: row.diagnosisCode,
    diagnosisName: row.diagnosisName,
    status: row.status,
    scheduledAppointmentId: row.scheduledAppointmentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type DoctorRef = { name: string; doctor: { nameRu: string } | null } | null;

function docName(u: DoctorRef): string | null {
  if (!u) return null;
  return u.doctor?.nameRu ?? u.name;
}

function serializeRow(
  row: CreatedReferral & {
    patient: { fullName: string };
    fromDoctor: { name: string; doctor: { nameRu: string } | null };
    toDoctor: { name: string; doctor: { nameRu: string } | null } | null;
  },
) {
  return {
    ...serialize(row),
    patientName: row.patient.fullName,
    fromDoctorName: docName(row.fromDoctor),
    toDoctorName: docName(row.toDoctor),
  };
}
