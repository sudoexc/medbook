/**
 * /api/crm/appointments — list + create. See docs/TZ.md §6.2, §7.8.
 *
 * POST runs full conflict detection (doctor/cabinet overlap + time-off +
 * schedule window) before creating the appointment and the AppointmentService
 * join rows. Returns 409 { error: "conflict", reason, until? } on conflict.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, conflict, parseQuery } from "@/server/http";
import {
  CreateAppointmentSchema,
  QueryAppointmentSchema,
} from "@/server/schemas/appointment";
import {
  applyTime,
  computeEndDate,
  detectConflicts,
} from "@/server/services/appointments";

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

    // DOCTOR sees only their own records
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor) return ok({ rows: [], total: 0, nextCursor: null });
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
    return ok({ rows, nextCursor, total });
  }
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: CreateAppointmentSchema,
  },
  async ({ request, body, ctx }) => {
    const startAt = applyTime(body.date, body.time);
    const endAt = computeEndDate(startAt, body.durationMin);

    const c = await detectConflicts({
      doctorId: body.doctorId,
      cabinetId: body.cabinetId ?? null,
      startAt,
      endAt,
    });
    if (!c.ok) {
      return conflict(c.reason, c.until ? { until: c.until } : undefined);
    }

    // Compute base price from primary service if not provided.
    let priceBase: number | null = null;
    let priceService: number | null = null;
    if (body.serviceId) {
      const svc = await prisma.service.findUnique({
        where: { id: body.serviceId },
        select: { priceBase: true, durationMin: true },
      });
      priceBase = svc?.priceBase ?? null;
      priceService = svc?.priceBase ?? null;
    }
    const priceFinal =
      body.priceFinal ??
      (priceBase !== null
        ? Math.max(
            0,
            priceBase - (body.discountAmount ?? 0) -
              Math.round(((body.discountPct ?? 0) * priceBase) / 100)
          )
        : null);

    const createdById = ctx.kind === "TENANT" ? ctx.userId : null;

    const created = await prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          patientId: body.patientId,
          doctorId: body.doctorId,
          cabinetId: body.cabinetId ?? null,
          serviceId: body.serviceId ?? null,
          date: startAt,
          time: body.time ?? null,
          durationMin: body.durationMin,
          endDate: endAt,
          status: "BOOKED",
          queueStatus: "BOOKED",
          channel: body.channel,
          leadId: body.leadId ?? null,
          priceService,
          priceBase,
          discountPct: body.discountPct ?? 0,
          discountAmount: body.discountAmount ?? 0,
          priceFinal,
          createdById,
          comments: body.comments ?? null,
          notes: body.notes ?? null,
        } as never,
      });
      if (body.services && body.services.length > 0) {
        const svcRows = await tx.service.findMany({
          where: { id: { in: body.services.map((s) => s.serviceId) } },
          select: { id: true, priceBase: true },
        });
        const priceMap = new Map(svcRows.map((s) => [s.id, s.priceBase]));
        await tx.appointmentService.createMany({
          data: body.services.map((s) => ({
            appointmentId: appt.id,
            serviceId: s.serviceId,
            priceSnap: s.priceOverride ?? priceMap.get(s.serviceId) ?? 0,
            quantity: s.quantity ?? 1,
          })) as never,
        });
      }
      return appt;
    });

    await audit(request, {
      action: "appointment.create",
      entityType: "Appointment",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created, 201);
  }
);

// Method-not-allowed hints for the other verbs handled by /[id] route.
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
