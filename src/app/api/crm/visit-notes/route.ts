/**
 * /api/crm/visit-notes — POST upserts a DRAFT VisitNote for an appointment.
 *
 * Doctor opens /doctor/reception with an active appointment; client calls
 * POST { appointmentId }. We return the existing note if one is already
 * attached (one-to-one via Appointment.visitNoteId / VisitNote.appointmentId
 * unique), or create a fresh DRAFT.
 *
 * GET lists notes for the calling doctor (used by /doctor/conclusions list
 * later in Phase 4 — we ship the endpoint now so the schema stays in one
 * place).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, forbidden, notFound, parseQuery } from "@/server/http";
import {
  UpsertVisitNoteSchema,
  QueryVisitNoteSchema,
} from "@/server/schemas/visit-note";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryVisitNoteSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.patientId) where.patientId = q.patientId;

    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor) return ok({ rows: [], nextCursor: null });
      where.doctorId = doctor.id;
    } else if (q.doctorId) {
      where.doctorId = q.doctorId;
    }

    if (q.q && q.q.trim().length > 0) {
      const term = q.q.trim();
      where.OR = [
        { diagnosisName: { contains: term, mode: "insensitive" } },
        { diagnosisCode: { contains: term, mode: "insensitive" } },
        { patient: { fullName: { contains: term, mode: "insensitive" } } },
      ];
    }

    const take = q.limit + 1;
    const rows = await prisma.visitNote.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        patient: { select: { id: true, fullName: true } },
        appointment: { select: { id: true, date: true, status: true } },
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    return ok({ rows, nextCursor });
  },
);

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: UpsertVisitNoteSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return err("Forbidden", 403, { reason: "not_a_doctor" });

    const appointment = await prisma.appointment.findUnique({
      where: { id: body.appointmentId },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        doctorId: true,
        status: true,
        startedAt: true,
      },
    });
    if (!appointment) return notFound();
    if (appointment.doctorId !== doctor.id) return forbidden();

    const existing = await prisma.visitNote.findUnique({
      where: { appointmentId: body.appointmentId },
    });
    if (existing) return ok(existing);

    const created = await prisma.visitNote.create({
      data: {
        clinicId: appointment.clinicId,
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: doctor.id,
        status: "DRAFT",
        startedAt: appointment.startedAt ?? new Date(),
      } as never,
    });

    await audit(request, {
      action: "visit_note.create",
      entityType: "VisitNote",
      entityId: created.id,
      meta: { appointmentId: appointment.id },
    });

    return ok(created, 201);
  },
);
