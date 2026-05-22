/**
 * /api/crm/lab-orders — create + list lab orders (Phase G3).
 *
 * POST: a doctor creates a new lab order during a visit. The patient must be
 * tied to this doctor via an appointment row (same anti-leak gate used on
 * /doctors/me/labs). Test/panel codes are validated against the catalog —
 * unknown codes are rejected so we don't ship a paper направление with a
 * bogus test on it.
 *
 * The `orderNumber` is computed server-side as `LO-YYYYMMDD-NNNN` from the
 * count of orders for the same clinic on that calendar day. Race conditions
 * are tolerated — the column is UNIQUE so a collision retries with N+1.
 *
 * Audit: `LAB_ORDER_CREATED`. SSE: `lab.order.created` for the clinic
 * channel (front desk / nurse views can show new orders live in G3+).
 *
 * GET: filter by patientId / visitNoteId / status. ADMIN sees all clinic
 * orders; DOCTOR sees only their own.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
import { ok, err, parseQuery } from "@/server/http";
import {
  CreateLabOrderSchema,
  QueryLabOrdersSchema,
} from "@/server/schemas/lab";

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: CreateLabOrderSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    if (body.testCodes.length === 0 && body.panelCodes.length === 0) {
      return err("BadRequest", 400, { reason: "empty_order" });
    }

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
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

    if (body.testCodes.length > 0) {
      const known = await prisma.labTest.findMany({
        where: { code: { in: body.testCodes }, active: true },
        select: { code: true },
      });
      const knownSet = new Set(known.map((r) => r.code));
      const missing = body.testCodes.filter((c) => !knownSet.has(c));
      if (missing.length > 0) {
        return err("BadRequest", 400, {
          reason: "unknown_test_codes",
          missing,
        });
      }
    }
    if (body.panelCodes.length > 0) {
      const known = await prisma.labPanel.findMany({
        where: { code: { in: body.panelCodes }, active: true },
        select: { code: true },
      });
      const knownSet = new Set(known.map((r) => r.code));
      const missing = body.panelCodes.filter((c) => !knownSet.has(c));
      if (missing.length > 0) {
        return err("BadRequest", 400, {
          reason: "unknown_panel_codes",
          missing,
        });
      }
    }

    const orderNumber = await nextOrderNumber(ctx.clinicId);

    const created = await prisma.labOrder.create({
      data: {
        orderNumber,
        clinicId: ctx.clinicId,
        patientId: body.patientId,
        doctorId: ctx.userId,
        appointmentId: body.appointmentId ?? null,
        visitNoteId: body.visitNoteId ?? null,
        testCodes: body.testCodes,
        panelCodes: body.panelCodes,
        diagnosisCode: body.diagnosisCode ?? null,
        notes: body.notes ?? null,
        urgency: body.urgency,
        status: "ORDERED",
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.LAB_ORDER_CREATED,
      entityType: "LabOrder",
      entityId: created.id,
      meta: {
        doctorId: ctx.userId,
        patientId: created.patientId,
        testCodes: created.testCodes,
        panelCodes: created.panelCodes,
        urgency: created.urgency,
        orderNumber: created.orderNumber,
      },
    });

    publishEventSafe(ctx.clinicId, {
      type: "lab.order.created",
      payload: {
        labOrderId: created.id,
        orderNumber: created.orderNumber,
        doctorId: ctx.userId,
        patientId: created.patientId,
        urgency: created.urgency,
      },
    });

    return ok(serializeOrder(created), 201);
  },
);

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QueryLabOrdersSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = { clinicId: ctx.clinicId };
    if (q.patientId) where.patientId = q.patientId;
    if (q.visitNoteId) where.visitNoteId = q.visitNoteId;
    if (q.status) where.status = q.status;
    if (ctx.role === "DOCTOR") where.doctorId = ctx.userId;

    const rows = await prisma.labOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });

    return ok({ rows: rows.map(serializeOrder), total: rows.length });
  },
);

async function nextOrderNumber(clinicId: string): Promise<string> {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const dayPrefix = `LO-${y}${m}${d}`;
  const startOfDay = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()));
  const count = await prisma.labOrder.count({
    where: { clinicId, createdAt: { gte: startOfDay } },
  });
  const seq = String(count + 1).padStart(4, "0");
  return `${dayPrefix}-${seq}`;
}

type LabOrderRow = {
  id: string;
  orderNumber: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  visitNoteId: string | null;
  testCodes: string[];
  panelCodes: string[];
  diagnosisCode: string | null;
  notes: string | null;
  urgency: "ROUTINE" | "URGENT" | "STAT";
  status: "DRAFT" | "ORDERED" | "COLLECTED" | "COMPLETED" | "CANCELLED";
  printedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function serializeOrder(row: LabOrderRow) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    patientId: row.patientId,
    doctorId: row.doctorId,
    appointmentId: row.appointmentId,
    visitNoteId: row.visitNoteId,
    testCodes: row.testCodes,
    panelCodes: row.panelCodes,
    diagnosisCode: row.diagnosisCode,
    notes: row.notes,
    urgency: row.urgency,
    status: row.status,
    printedAt: row.printedAt ? row.printedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
