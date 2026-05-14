/**
 * POST /api/crm/doctors/me/labs — manual lab-result entry.
 *
 * Until a lab-system integration lands, doctors paste values off paper
 * reports. We accept whatever string they typed — `value` is stored as
 * text so ranges ("3.5–5.5") and qualitative results ("положит.") survive.
 *
 * The doctor must (a) be the ordering doctor (we stamp `doctorId =
 * ctx.userId` regardless of what the caller sends, anti-impersonation),
 * (b) have an appointment relationship with the patient — same anti-leak
 * rule used on the visits endpoints.
 *
 * Default status is RESULTED (= "пришёл, врач ещё не смотрел") rather than
 * PENDING because the doctor only enters something here once a result
 * exists. PENDING is reserved for lab-system integrations that pre-create
 * the row when the order ships.
 *
 * SSE: `lab.result.received`. Audit: LAB_RESULT_CREATED.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
import { ok, err } from "@/server/http";

const LAB_FLAGS = ["NORMAL", "LOW", "HIGH", "CRITICAL"] as const;

const CreateBody = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1).optional().nullable(),
  visitNoteId: z.string().min(1).optional().nullable(),
  testName: z.string().trim().min(1).max(200),
  testCode: z.string().trim().max(64).optional().nullable(),
  value: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(32).optional().nullable(),
  refRange: z.string().trim().max(64).optional().nullable(),
  flag: z.enum(LAB_FLAGS).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: CreateBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("Forbidden", 403, { reason: "no_doctor_row_for_user" });
    }

    // Anti-leak — patient must be in this clinic AND have an appointment
    // history with this doctor. The tenant extension already scopes the
    // patient lookup to the clinic; we check the doctor relationship
    // explicitly.
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

    // Optional appointment/visit-note links — both must belong to this
    // doctor + patient to prevent cross-stitching.
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

    const created = await prisma.labResult.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: body.patientId,
        doctorId: ctx.userId,
        appointmentId: body.appointmentId ?? null,
        visitNoteId: body.visitNoteId ?? null,
        testName: body.testName,
        testCode: body.testCode ?? null,
        value: body.value,
        unit: body.unit ?? null,
        refRange: body.refRange ?? null,
        flag: body.flag ?? null,
        notes: body.notes ?? null,
        // Manual entries start as RESULTED — the doctor only sees them in
        // the unread feed until they explicitly mark REVIEWED. CRITICAL
        // flags stay unread regardless until reviewed, by design.
        status: "RESULTED",
      },
      select: {
        id: true,
        patientId: true,
        doctorId: true,
        testName: true,
        value: true,
        unit: true,
        refRange: true,
        flag: true,
        status: true,
        receivedAt: true,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.LAB_RESULT_CREATED,
      entityType: "LabResult",
      entityId: created.id,
      meta: {
        doctorId: ctx.userId,
        patientId: created.patientId,
        testName: created.testName,
        flag: created.flag,
        source: "manual",
      },
    });

    publishEventSafe(ctx.clinicId, {
      type: "lab.result.received",
      payload: {
        labResultId: created.id,
        doctorId: ctx.userId,
        patientId: created.patientId,
        flag: created.flag,
      },
    });

    return ok(
      {
        id: created.id,
        patientId: created.patientId,
        testName: created.testName,
        value: created.value,
        unit: created.unit,
        refRange: created.refRange,
        flag: created.flag,
        status: created.status,
        receivedAt: created.receivedAt.toISOString(),
      },
      201,
    );
  },
);
