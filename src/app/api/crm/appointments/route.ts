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
import { normalizePhone } from "@/lib/phone";
import {
  CreateAppointmentSchema,
  QueryAppointmentSchema,
} from "@/server/schemas/appointment";
import {
  applyTime,
  computeEndDate,
  detectConflicts,
} from "@/server/services/appointments";
import { fireTrigger } from "@/server/notifications/triggers";
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";

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

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: CreateAppointmentSchema,
  },
  async ({ request, body, ctx }) => {
    const startAt = applyTime(body.date, body.time);
    const endAt = computeEndDate(startAt, body.durationMin);

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

    // Conflict check + create run in one Serializable transaction so that
    // concurrent bookings on the same slot can't both pass the overlap check.
    // PostgreSQL raises a serialization error (P2034) on the loser; we
    // surface that as a doctor_busy/cabinet_busy 409 just like a normal clash.
    let txResult:
      | { kind: "ok"; appt: { id: string; doctorId: string; patientId: string; cabinetId: string | null; status: string; date: Date; queueStatus: string } }
      | { kind: "conflict"; reason: string; until?: string };
    try {
      txResult = await prisma.$transaction(
        async (tx) => {
        const c = await detectConflicts(
          {
            doctorId: body.doctorId,
            cabinetId: body.cabinetId ?? null,
            startAt,
            endAt,
          },
          tx,
        );
        if (!c.ok) {
          return { kind: "conflict" as const, reason: c.reason, until: c.until };
        }
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
        return { kind: "ok" as const, appt };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (e: unknown) {
      // Postgres serialization / write conflict — Prisma 7 surfaces this as a
      // DriverAdapterError with kind=TransactionWriteConflict / originalCode
      // 40001 (or as P2034). The DB-level EXCLUDE constraint added in
      // 20260429_appointment_no_overlap surfaces as SQLSTATE 23P01
      // (exclusion_violation) — same outcome, just a different SQLSTATE.
      const err = e as {
        code?: string;
        originalCode?: string;
        kind?: string;
        name?: string;
        message?: string;
      } | null;
      // Prisma 7 + pg adapter surfaces concurrent-booking failures in three
      // shapes that all mean "lost the race, retry would race again":
      //   1. DriverAdapterError with originalCode/code "23P01" (EXCLUDE
      //      constraint Appointment_doctor_no_overlap fired)
      //   2. P2034 or originalCode "40001" — Serializable retry budget hit
      //   3. DriverAdapterError whose message string carries either of the
      //      above (Prisma sometimes wraps the original PG error and drops
      //      the SQLSTATE — only the human message survives)
      const msg = err?.message ?? "";
      const isAdapterErr = err?.name === "DriverAdapterError";
      const msgIndicatesConflict =
        msg.includes("exclusion constraint") ||
        msg.includes("Appointment_doctor_no_overlap") ||
        msg.includes("Appointment_cabinet_no_overlap") ||
        msg.includes("write conflict or a deadlock") ||
        msg.includes("could not serialize access");
      const isWriteConflict =
        err?.code === "P2034" ||
        err?.code === "40001" ||
        err?.code === "23P01" ||
        err?.originalCode === "40001" ||
        err?.originalCode === "23P01" ||
        err?.kind === "TransactionWriteConflict" ||
        (isAdapterErr && msgIndicatesConflict) ||
        msgIndicatesConflict;
      if (isWriteConflict) {
        const c = await detectConflicts({
          doctorId: body.doctorId,
          cabinetId: body.cabinetId ?? null,
          startAt,
          endAt,
        });
        if (!c.ok) {
          return conflict(c.reason, c.until ? { until: c.until } : undefined);
        }
        return conflict("doctor_busy");
      }
      // Diagnostic: surface the exact shape of unhandled errors so the catch
      // can be widened next time. Cheap noise — happens only on real 500s.
      // eslint-disable-next-line no-console
      console.error("[POST /appointments] uncaught error shape:", {
        name: err?.name,
        code: err?.code,
        originalCode: err?.originalCode,
        kind: err?.kind,
        message: err?.message?.slice(0, 200),
        ctorName: (e as { constructor?: { name?: string } } | null)?.constructor?.name,
      });
      throw e;
    }
    if (txResult.kind === "conflict") {
      return conflict(
        txResult.reason,
        txResult.until ? { until: txResult.until } : undefined,
      );
    }
    const created = txResult.appt;

    await audit(request, {
      action: "appointment.create",
      entityType: "Appointment",
      entityId: created.id,
      meta: { after: created },
    });
    // Phase 3a: fire notifications trigger (immediate + 24h/2h reminders).
    fireTrigger({ kind: "appointment.created", appointmentId: created.id });

    // Realtime: fan out to reception/calendar/appointments lists.
    const tenant = getTenant();
    const clinicId =
      tenant?.kind === "TENANT" ? tenant.clinicId : null;
    if (clinicId) {
      publishEventSafe(clinicId, {
        type: "appointment.created",
        payload: {
          appointmentId: created.id,
          doctorId: created.doctorId,
          patientId: created.patientId,
          cabinetId: created.cabinetId,
          status: created.status,
          date: created.date.toISOString(),
        },
      });
      publishEventSafe(clinicId, {
        type: "queue.updated",
        payload: {
          appointmentId: created.id,
          doctorId: created.doctorId,
          queueStatus: created.queueStatus,
        },
      });
    }
    return ok(created, 201);
  }
);

// Method-not-allowed hints for the other verbs handled by /[id] route.
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
