/**
 * GET /api/miniapp/appointments?clinicSlug=… — list patient's appointments.
 *   Query: scope=upcoming|past (default "upcoming"), limit?.
 *
 * POST /api/miniapp/appointments — book an appointment.
 *   Body: { doctorId, serviceIds[], startAt (ISO), patientName?, patientPhone?, lang? }
 *
 * Both are scoped to the authenticated patient (via `ctx.patientId`) and the
 * clinic (via `ctx.clinicId`).
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { conflict, err, ok } from "@/server/http";
import { createMiniAppHandler, createMiniAppListHandler } from "@/server/miniapp/handler";
import {
  computeEndDate,
  detectConflicts,
} from "@/server/services/appointments";
import { fireTrigger } from "@/server/notifications/triggers";

const BookBody = z.object({
  doctorId: z.string().min(1),
  serviceIds: z.array(z.string()).min(1),
  startAt: z.string().datetime(),
  patientName: z.string().trim().min(1).optional(),
  patientPhone: z.string().trim().optional(),
  lang: z.enum(["RU", "UZ"]).optional(),
  comments: z.string().max(1000).optional(),
});

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "upcoming";
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
    100,
  );
  const now = new Date();
  const where: Record<string, unknown> = {
    clinicId: ctx.clinicId,
    patientId: ctx.patientId,
  };
  if (scope === "upcoming") {
    where.status = { notIn: ["CANCELLED", "COMPLETED", "NO_SHOW"] };
    where.date = { gte: now };
  } else {
    where.OR = [
      { status: { in: ["COMPLETED", "NO_SHOW", "CANCELLED"] } },
      { date: { lt: now } },
    ];
  }
  const rows = await prisma.appointment.findMany({
    where,
    orderBy: { date: scope === "upcoming" ? "asc" : "desc" },
    take: limit,
    include: {
      doctor: {
        select: {
          id: true,
          nameRu: true,
          nameUz: true,
          specializationRu: true,
          specializationUz: true,
          photoUrl: true,
        },
      },
      cabinet: { select: { id: true, number: true } },
      primaryService: { select: { id: true, nameRu: true, nameUz: true } },
      services: {
        include: {
          service: {
            select: { id: true, nameRu: true, nameUz: true, priceBase: true },
          },
        },
      },
      payments: { select: { id: true, amount: true, status: true, method: true } },
    },
  });
  return ok({ appointments: rows });
});

export const POST = createMiniAppHandler(
  { bodySchema: BookBody },
  async ({ body, ctx }) => {
    // Confirm doctor + services belong to this clinic.
    const [doctor, services] = await Promise.all([
      prisma.doctor.findFirst({
        where: { id: body.doctorId, clinicId: ctx.clinicId, isActive: true },
        select: { id: true },
      }),
      prisma.service.findMany({
        where: {
          id: { in: body.serviceIds },
          clinicId: ctx.clinicId,
          isActive: true,
        },
        select: { id: true, priceBase: true, durationMin: true },
      }),
    ]);
    if (!doctor) return err("doctor_not_found", 404);
    if (services.length !== body.serviceIds.length) {
      return err("service_not_found", 404);
    }
    const durationMin = services.reduce((a, s) => a + s.durationMin, 0) || 30;
    const startAt = new Date(body.startAt);
    if (Number.isNaN(startAt.getTime())) return err("bad_start_at", 400);
    const endAt = computeEndDate(startAt, durationMin);

    const c = await detectConflicts({
      doctorId: body.doctorId,
      cabinetId: null,
      startAt,
      endAt,
    });
    if (!c.ok) {
      return conflict(c.reason, c.until ? { until: c.until } : undefined);
    }

    // Optional profile update: sync name/phone/lang from the booking form.
    const patientUpdate: Record<string, unknown> = {};
    if (body.patientName && body.patientName !== ctx.patient.fullName) {
      patientUpdate.fullName = body.patientName;
    }
    if (body.patientPhone) {
      const normalized = normalizePhone(body.patientPhone);
      if (normalized && !normalized.startsWith("tg:")) {
        patientUpdate.phone = body.patientPhone;
        patientUpdate.phoneNormalized = normalized;
      }
    }
    if (body.lang && body.lang !== ctx.patient.preferredLang) {
      patientUpdate.preferredLang = body.lang;
    }
    if (Object.keys(patientUpdate).length > 0) {
      await prisma.patient.update({
        where: { id: ctx.patientId },
        data: patientUpdate,
      });
    }

    // Compute price snapshot.
    const priceBase = services.reduce((a, s) => a + s.priceBase, 0);
    const primaryServiceId = body.serviceIds[0] ?? null;

    const time = `${String(startAt.getHours()).padStart(2, "0")}:${String(
      startAt.getMinutes(),
    ).padStart(2, "0")}`;

    const created = await prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: ctx.patientId,
          doctorId: body.doctorId,
          serviceId: primaryServiceId,
          date: startAt,
          time,
          durationMin,
          endDate: endAt,
          status: "BOOKED",
          queueStatus: "BOOKED",
          channel: "TELEGRAM",
          priceService: priceBase,
          priceBase,
          priceFinal: priceBase,
          comments: body.comments ?? null,
        } as never,
      });
      await tx.appointmentService.createMany({
        data: body.serviceIds.map((sid) => ({
          clinicId: ctx.clinicId,
          appointmentId: appt.id,
          serviceId: sid,
          priceSnap: services.find((s) => s.id === sid)?.priceBase ?? 0,
          quantity: 1,
        })) as never,
      });
      return appt;
    });

    fireTrigger({ kind: "appointment.created", appointmentId: created.id });

    return ok(
      {
        appointment: {
          id: created.id,
          date: created.date,
          endDate: created.endDate,
          time: created.time,
          durationMin: created.durationMin,
          priceFinal: created.priceFinal,
          status: created.status,
        },
      },
      201,
    );
  },
);
