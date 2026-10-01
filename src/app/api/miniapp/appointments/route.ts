/**
 * GET /api/miniapp/appointments?clinicSlug=… — list patient's appointments.
 *   Query: scope=upcoming|past (default "upcoming"), limit?.
 *
 * POST /api/miniapp/appointments — book an appointment.
 *   Body: { doctorId, serviceIds[], startAt (ISO), patientName?, patientPhone?, lang?,
 *           medicalCaseId? }
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
 * Limits (audit MA-14): at most `MINIAPP_MAX_SERVICES_PER_BOOKING` services,
 * all offered by the doctor; a start the picker offers (the doctor's 20
 * minute grid, inside the 14 day horizon); a few booked visits ahead per
 * patient, one per doctor (409 `booking_limit`); and a short-window budget
 * of attempts per Telegram account (429 `rate_limited`).
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
import {
  MINIAPP_APPOINTMENT_SELECT,
  miniAppFollowUp,
} from "@/server/miniapp/appointment-view";
import { queueTicketToken } from "@/server/appointments/public-ticket";
import { miniAppDocumentUrl } from "@/server/miniapp/link-token";
import { getMetrics } from "@/server/observability/metrics";
import { miniAppAppointmentScopeWhere } from "@/server/miniapp/appointment-scope";
import {
  allowMiniAppBookingAttempt,
  miniAppBookingLimitRefusal,
} from "@/server/miniapp/booking-limits";
import { isOfferedSlotStart } from "@/server/services/appointments";
import {
  isWithinBookingHorizon,
  MINIAPP_MAX_SERVICES_PER_BOOKING,
} from "@/lib/appointments/patient-booking";
import { REFERRAL_PROGRAM_LIVE } from "@/lib/patient-experience/referral-reward";

const BookBody = z.object({
  doctorId: z.string().min(1).max(64),
  // The wizard sends the doctor's one online service; ten services in one
  // booking used to close the doctor's whole day (MA-14).
  serviceIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MINIAPP_MAX_SERVICES_PER_BOOKING),
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
  // The open case the patient is continuing, when the wizard was started
  // from the treatment-plan card (audit MA-11). A hint, not an order: the
  // case-attach step files the visit there only if it is still an OPEN case
  // of this patient, and otherwise falls back to its usual choice.
  medicalCaseId: z.string().min(1).max(64).optional(),
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
  // Today's visits and the live queue stay «upcoming» until they finish,
  // not until their start time passes (audit MA-20).
  const where = {
    clinicId: ctx.clinicId,
    patientId: active.patientId,
    ...miniAppAppointmentScopeWhere(
      scope === "upcoming" ? "upcoming" : "past",
      new Date(),
    ),
  };
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
    // The patient's own key to the live queue card (audit INF-10): the
    // public status endpoint no longer takes the bare appointment id.
    queueToken: queueTicketToken(row.id),
    // A link for this one conclusion, never initData (MA-07).
    conclusionUrl: visitNote?.conclusionDocument
      ? miniAppDocumentUrl({
          clinicId: ctx.clinicId,
          clinicSlug: ctx.clinicSlug,
          patientId: active.patientId,
          documentId: visitNote.conclusionDocument.id,
        })
      : null,
    ...miniAppFollowUp(visitNote, row.date),
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
    // Counted per Telegram account, inside the idempotency wrapper so a
    // replayed double tap is not an extra attempt.
    if (!allowMiniAppBookingAttempt(ctx.clinicId, ctx.patientId)) {
      return err("rate_limited", 429);
    }
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

    // Only services this doctor offers (audit MA-08). The wizard sends the
    // doctor's online service; a crafted or stale body naming another one
    // would book him at a price and length that are not his.
    const wanted = Array.from(new Set(body.serviceIds));
    const linked = await prisma.serviceOnDoctor.count({
      where: { doctorId: body.doctorId, serviceId: { in: wanted } },
    });
    if (linked !== wanted.length) return err("service_not_found", 404);

    // Only a start the picker offers (MA-14): the 14 days of the strip, the
    // doctor's grid and hours for the length of these services.
    const now = new Date();
    if (!isWithinBookingHorizon(startAt, now)) return err("beyond_horizon", 400);
    const services = await prisma.service.findMany({
      where: { id: { in: wanted }, clinicId: ctx.clinicId, isActive: true },
      select: { durationMin: true },
    });
    const durationMin = services.reduce((a, sv) => a + sv.durationMin, 0) || 30;
    if (!(await isOfferedSlotStart({ doctorId: body.doctorId, startAt, durationMin }))) {
      return err("off_grid", 400);
    }

    // Optional profile update (after every refusal above, so a refused
    // booking changes nothing): sync name/lang from the booking form — but
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

    const primaryServiceId = wanted[0] ?? null;
    const preferredLang = body.lang ?? active.preferredLang;

    const result = await bookAppointment({
      clinicId: ctx.clinicId,
      patientId: active.patientId,
      doctorId: body.doctorId,
      startAt,
      serviceId: primaryServiceId,
      services: wanted.map((sid) => ({ serviceId: sid, quantity: 1 })),
      channel: "TELEGRAM",
      comments: body.comments ?? null,
      // Hidden until the program is built end to end (audit MA-19).
      applyReferralReward: REFERRAL_PROGRAM_LIVE,
      guard: (tx) =>
        miniAppBookingLimitRefusal(tx, {
          clinicId: ctx.clinicId,
          patientId: active.patientId,
          doctorId: body.doctorId,
          now,
        }),
      autoAttachCaseOptions: {
        clinicId: ctx.clinicId,
        patientId: active.patientId,
        doctorId: body.doctorId,
        startAt,
        preferredLang,
        primaryComplaint: body.comments ?? null,
        preferredCaseId: body.medicalCaseId ?? null,
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
        case "booking_limit":
          return conflict("booking_limit", { limit: result.limit });
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
