/**
 * /api/crm/appointments — list + create. See docs/TZ.md §6.2, §7.8.
 *
 * POST runs full conflict detection (doctor/cabinet overlap + time-off +
 * schedule window) before creating the appointment and the AppointmentService
 * join rows. Returns 409 { error: "conflict", reason, until? } on conflict.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, conflict, parseQuery } from "@/server/http";
import { normalizePhone } from "@/lib/phone";
import {
  CreateAppointmentSchema,
  QueryAppointmentSchema,
} from "@/server/schemas/appointment";
import { bookAppointment } from "@/server/appointments/book";
import { newCorrelationId } from "@/server/realtime/outbox";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryAppointmentSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.from || q.to) {
      where.date = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      };
    }
    if (q.doctorId) where.doctorId = q.doctorId;
    if (q.patientId) where.patientId = q.patientId;
    if (q.cabinetId) where.cabinetId = q.cabinetId;
    if (q.status) where.status = q.status;
    if (q.channel) where.channel = q.channel;
    if (q.unpaid) {
      where.payments = {
        none: { status: "PAID" },
      };
    }
    if (q.q && q.q.trim().length > 0) {
      const term = q.q.trim();
      const phoneDigits = term.replace(/\D/g, "");
      const phoneNorm = normalizePhone(term);
      const or: Array<Record<string, unknown>> = [
        { patient: { fullName: { contains: term, mode: "insensitive" } } },
        { patient: { phone: { contains: term } } },
        { doctor: { nameRu: { contains: term, mode: "insensitive" } } },
        { doctor: { nameUz: { contains: term, mode: "insensitive" } } },
      ];
      if (phoneDigits.length >= 3) {
        or.push({ patient: { phoneNormalized: { contains: phoneDigits } } });
        if (phoneNorm) {
          or.push({ patient: { phoneNormalized: { contains: phoneNorm } } });
        }
      }
      where.OR = or;
    }

    // DOCTOR sees only their own records
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor) {
        return ok({
          rows: [],
          total: 0,
          nextCursor: null,
          tally: {
            all: 0,
            BOOKED: 0,
            WAITING: 0,
            IN_PROGRESS: 0,
            COMPLETED: 0,
            CANCELLED: 0,
            NO_SHOW: 0,
            SKIPPED: 0,
          },
        });
      }
      where.doctorId = doctor.id;
    }

    const take = q.limit + 1;
    const rows = await prisma.appointment.findMany({
      where,
      orderBy: { [q.sort]: q.dir },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        patient: {
          select: { id: true, fullName: true, phone: true, photoUrl: true },
        },
        doctor: {
          select: { id: true, nameRu: true, nameUz: true, photoUrl: true, color: true },
        },
        cabinet: { select: { id: true, number: true } },
        primaryService: { select: { id: true, nameRu: true, nameUz: true } },
        payments: {
          select: { id: true, amount: true, status: true, method: true },
        },
        services: {
          include: {
            service: { select: { id: true, nameRu: true, nameUz: true, priceBase: true } },
          },
        },
      },
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    const total = await prisma.appointment.count({ where });

    // KPI-strip badge counts: respect every other filter except status,
    // so switching tabs doesn't zero out the others. Mirrors the segment-tab
    // pattern in /api/crm/patients.
    const { status: _omit, ...whereWithoutStatus } = where;
    const grouped = await prisma.appointment.groupBy({
      by: ["status"],
      where: whereWithoutStatus,
      _count: { _all: true },
    });
    const tally: Record<string, number> = {
      all: 0,
      BOOKED: 0,
      WAITING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      NO_SHOW: 0,
      SKIPPED: 0,
    };
    for (const g of grouped) {
      const c = g._count?._all ?? 0;
      tally[g.status] = c;
      tally.all += c;
    }

    return ok({ rows, nextCursor, total, tally });
  }
);

// Auto-confirm channels: the patient is either physically in the clinic
// (WALKIN at the desk, KIOSK in the lobby) or had a live conversation with
// reception/callcenter (PHONE). In all three cases the confirmation step
// happened during booking itself — no need for a follow-up reminder Action.
// TELEGRAM / WEBSITE bookings are remote/self-service and stay BOOKED until
// the unconfirmed-window detector posts a confirm-call task.
// WALKIN is unreachable here since the two-lanes guard (bookAppointment
// rejects it; walk-ins go via registerWalkin) — kept out deliberately.
const AUTO_CONFIRM_CHANNELS = new Set<string>(["PHONE", "KIOSK"]);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: CreateAppointmentSchema,
  },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const actorRole = ctx.role === "DOCTOR" ? "DOCTOR" : "RECEPTIONIST";
    const actorUserId = ctx.userId || null;

    const result = await bookAppointment({
      clinicId: ctx.clinicId,
      patientId: body.patientId,
      doctorId: body.doctorId,
      startAt: body.date,
      time: body.time ?? null,
      serviceId: body.serviceId ?? null,
      services: body.services,
      durationMin: body.durationMin,
      discountPct: body.discountPct,
      discountAmount: body.discountAmount,
      priceFinal: body.priceFinal ?? null,
      medicalCaseId: body.medicalCaseId ?? null,
      channel: body.channel,
      notes: body.notes ?? null,
      comments: body.comments ?? null,
      leadId: body.leadId ?? null,
      createdById: actorUserId,
      autoConfirm: AUTO_CONFIRM_CHANNELS.has(body.channel),
      actor: {
        role: actorRole,
        userId: actorUserId,
        patientId: null,
        onBehalfOfPatientId: null,
        label: actorUserId ? `user:${actorUserId}` : "user:anonymous",
      },
      surface: "CRM",
      correlationId: newCorrelationId(),
    });

    if (!result.ok) {
      switch (result.reason) {
        case "doctor_not_found":
        case "doctor_inactive":
          return err("DoctorInvalid", 422, { reason: "doctor_not_found" });
        case "cabinet_inactive":
          return err("CabinetInactive", 422, { reason: "cabinet_inactive" });
        case "service_not_found":
          return err("ServiceInvalid", 422, { reason: "service_not_found" });
        case "doctor_busy":
        case "cabinet_busy":
        case "doctor_time_off":
        case "outside_schedule":
        case "in_past":
          return conflict(
            result.reason,
            result.until ? { until: result.until } : undefined,
          );
        case "bad_start_at":
          return err("BadStartAt", 400, { reason: "bad_start_at" });
        case "bad_channel":
          return err("BadChannel", 422, { reason: "bad_channel" });
      }
    }

    return ok(result.appointment, 201);
  },
);

// Method-not-allowed hints for the other verbs handled by /[id] route.
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
