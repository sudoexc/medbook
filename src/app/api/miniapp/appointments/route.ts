/**
 * GET /api/miniapp/appointments?clinicSlug=… — list patient's appointments.
 *   Query: scope=upcoming|past (default "upcoming"), limit?.
 *
 * POST /api/miniapp/appointments — book an appointment.
 *   Body: { doctorId, serviceIds[], startAt (ISO), patientName?, patientPhone?, lang? }
 *
 * Both are scoped to the authenticated patient (via `ctx.patientId`) and the
 * clinic (via `ctx.clinicId`).
 *
 * Mini-app overhaul Phase M1 — POST delegates to the shared
 * `bookAppointment` kernel; the only mini-app-specific logic kept here is
 * (a) the on-behalf-of family resolution, (b) the optional profile-sync
 * side-effect, and (c) translating the kernel's discriminated `BookResult`
 * back into the mini-app's existing JSON shape.
 *
 * `patientPhone` is accepted from old clients and IGNORED (audit PH-01,
 * MA-04). Writing it into the card let anyone claim a stranger's number
 * (walk-in and CRM lookups trusted it), and a number another card already
 * held broke the unique index: every booking by a returning patient who
 * opened the bot for the first time failed with 500. The number reaches the
 * card only as the Telegram account's own shared contact.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { conflict, err, ok } from "@/server/http";
import { createMiniAppHandler, createMiniAppListHandler } from "@/server/miniapp/handler";
import { withIdempotency } from "@/server/miniapp/idempotency";
import { bookAppointment } from "@/server/appointments/book";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
import { MINIAPP_APPOINTMENT_SELECT } from "@/server/miniapp/appointment-view";
import { getMetrics } from "@/server/observability/metrics";

const BookBody = z.object({
  doctorId: z.string().min(1),
  serviceIds: z.array(z.string()).min(1),
  startAt: z.string().datetime(),
  patientName: z.string().trim().min(1).optional(),
  // Ignored — see the header.
  patientPhone: z.string().trim().optional(),
  lang: z.enum(["RU", "UZ"]).optional(),
  comments: z.string().max(1000).optional(),
  // Phase 16: when set, the booking is created against a linked relative.
  // The TG-authenticated owner remains the actor in audit/notifications,
  // but the appointment.patientId is the relative's id. Server validates
  // the PatientFamily link before honouring this.
  onBehalfOf: z.string().min(1).optional(),
});

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "upcoming";
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
    100,
  );
  const onBehalfOf = url.searchParams.get("onBehalfOf");
  const active = await resolveActivePatient({
    ctx: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      preferredLang: ctx.patient.preferredLang,
    },
    onBehalfOf,
  });
  if (!active.ok) return err(active.reason, 403);
  const now = new Date();
  const where: Record<string, unknown> = {
    clinicId: ctx.clinicId,
    patientId: active.patientId,
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
  // Explicit select, never include + spread (audit MA-10): the row carries
  // reception notes and cancel internals the patient must not receive.
  const rows = await prisma.appointment.findMany({
    where,
    orderBy: { date: scope === "upcoming" ? "asc" : "desc" },
    take: limit,
    select: MINIAPP_APPOINTMENT_SELECT,
  });
  const appointments = rows.map(({ visitNote, ...row }) => ({
    ...row,
    conclusionUrl: visitNote?.conclusionDocument
      ? `/api/miniapp/documents/${visitNote.conclusionDocument.id}/file?clinicSlug=${encodeURIComponent(ctx.clinicSlug)}`
      : null,
    followUpAt:
      visitNote?.followUpDays != null && visitNote.followUpDays > 0
        ? new Date(
            (visitNote.finalizedAt ?? row.date).getTime() +
              visitNote.followUpDays * 24 * 60 * 60 * 1000,
          ).toISOString()
        : null,
  }));
  return ok({ appointments });
});

export const POST = createMiniAppHandler(
  { bodySchema: BookBody },
  async ({ request, body, ctx }) => {
    // Phase M7 — Observe end-to-end booking latency. Histogram label
    // `outcome` separates the happy path (201) from validation rejects (4xx)
    // and downstream errors (5xx) so the p99 isn't polluted by short-circuit
    // returns.
    const start = process.hrtime.bigint();
    const observe = (outcome: "success" | "conflict" | "error") => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      getMetrics().bookingDuration.observe(seconds, { outcome });
    };
    try {
      // Phase M4 — Idempotency-Key replay. The MainButton-driven confirmation
      // screen is exactly the kind of place where a double-tap or flaky
      // network hand-off creates duplicate bookings. The key scope is
      // `<clinicId, patientId>`, so a relative booking via on-behalf-of still
      // hits the cache (the actor / owner stays the same).
      const response = await withIdempotency(
        request,
        { clinicId: ctx.clinicId, patientId: ctx.patientId },
        async () => {
    const active = await resolveActivePatient({
      ctx: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        preferredLang: ctx.patient.preferredLang,
      },
      onBehalfOf: body.onBehalfOf,
    });
    if (!active.ok) return err(active.reason, 403);

    const startAt = new Date(body.startAt);
    if (Number.isNaN(startAt.getTime())) return err("bad_start_at", 400);

    // Optional profile update: sync name/lang from the booking form — but
    // ONLY when booking for self. When acting on behalf of a relative,
    // the form fields belong to the relative; we skip this so the owner's
    // TG-tied profile stays intact, and we don't risk clobbering a relative
    // profile that was created via the family form. Never the phone (see
    // the header).
    if (!active.isOnBehalfOf) {
      const patientUpdate: Record<string, unknown> = {};
      if (body.patientName && body.patientName !== ctx.patient.fullName) {
        patientUpdate.fullName = body.patientName;
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
    }

    const primaryServiceId = body.serviceIds[0] ?? null;
    const preferredLang = body.lang ?? active.preferredLang;

    const result = await bookAppointment({
      clinicId: ctx.clinicId,
      patientId: active.patientId,
      doctorId: body.doctorId,
      startAt,
      serviceId: primaryServiceId,
      services: body.serviceIds.map((sid) => ({ serviceId: sid, quantity: 1 })),
      channel: "TELEGRAM",
      comments: body.comments ?? null,
      applyReferralReward: true,
      autoAttachCaseOptions: {
        clinicId: ctx.clinicId,
        patientId: active.patientId,
        doctorId: body.doctorId,
        startAt,
        preferredLang,
        primaryComplaint: body.comments ?? null,
      },
      actor: {
        role: "PATIENT",
        userId: null,
        patientId: ctx.patientId,
        onBehalfOfPatientId: active.isOnBehalfOf ? active.patientId : null,
        label: `patient:${ctx.patientId}`,
      },
      surface: "MINIAPP",
    });

    if (!result.ok) {
      switch (result.reason) {
        case "doctor_not_found":
        case "doctor_inactive":
          return err("doctor_not_found", 404);
        case "cabinet_inactive":
          return err("cabinet_inactive", 422);
        case "service_not_found":
          return err("service_not_found", 404);
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
          return err("bad_start_at", 400);
        case "bad_channel":
          // Unreachable from this route (channel is hardcoded TELEGRAM) —
          // kept for switch exhaustiveness over BookResult.
          return err("bad_channel", 422);
      }
    }

    return ok(
      {
        appointment: {
          id: result.appointment.id,
          date: result.appointment.date,
          endDate: result.appointment.endDate,
          time: result.appointment.time,
          ticketCode: result.appointment.ticketCode,
          durationMin: result.appointment.durationMin,
          priceFinal: result.appointment.priceFinal,
          status: result.appointment.status,
        },
        caseAttach: result.caseAttach,
      },
      201,
    );
        },
      );
      observe(
        response.status === 200 || response.status === 201
          ? "success"
          : response.status === 409
            ? "conflict"
            : "error",
      );
      return response;
    } catch (e) {
      observe("error");
      throw e;
    }
  },
);
