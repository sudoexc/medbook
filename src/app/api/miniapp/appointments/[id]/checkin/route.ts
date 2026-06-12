/**
 * Wave 3c — «Я на месте» self check-in (Mini App).
 *
 * POST /api/miniapp/appointments/:id/checkin
 *
 * The patient taps the button on the home hero when they reach the clinic.
 * This publishes an auditable `patient.arrived` envelope so the reception
 * desk gets a live toast + list refresh — it does NOT change the appointment
 * status. Intake (Пришёл → queueStatus=WAITING) stays a receptionist action
 * per `appointment-transitions`: the desk verifies the person is actually
 * standing there before queueing them.
 *
 * Guards: the appointment must belong to the acting patient (self or a
 * `PatientFamily`-linked relative via `?onBehalfOf=`), be scheduled for
 * today, and still be in BOOKED/CONFIRMED.
 */
import { prisma } from "@/lib/prisma";
import { err, forbidden, notFound, ok } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

const CHECKINABLE = new Set(["BOOKED", "CONFIRMED"]);

export const POST = createMiniAppHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  // .../appointments/<id>/checkin
  const appointmentId = segments[segments.length - 2] ?? "";
  if (!appointmentId) return err("missing_appointment_id", 400);

  const onBehalfOf = url.searchParams.get("onBehalfOf");
  const acting = await resolveActivePatient({
    ctx: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      preferredLang: ctx.patient.preferredLang,
    },
    onBehalfOf,
  });
  if (!acting.ok) return forbidden();

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId: ctx.clinicId },
    select: {
      id: true,
      patientId: true,
      doctorId: true,
      date: true,
      status: true,
      arrivedAt: true,
      patient: { select: { fullName: true } },
    },
  });
  if (!appt) return notFound();
  if (appt.patientId !== acting.patientId) return forbidden();
  if (!CHECKINABLE.has(appt.status)) {
    return err("not_checkinable", 409, { reason: "not_checkinable" });
  }
  // Idempotent: re-entering the Mini App resets client state, so a second
  // tap must not spam the desk with another patient.arrived toast.
  if (appt.arrivedAt) return ok({ ok: true, already: true });

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  if (appt.date < dayStart || appt.date >= dayEnd) {
    return err("not_today", 409, { reason: "not_today" });
  }

  const time = appt.date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const envelope: EventEnvelopeInput = {
    correlationId: newCorrelationId(),
    actor: {
      role: "PATIENT",
      userId: null,
      patientId: ctx.patientId,
      onBehalfOfPatientId: acting.isOnBehalfOf ? acting.patientId : null,
      label: `patient:${ctx.patientId}`,
    },
    surface: "MINIAPP",
    tenantScope: {
      clinicId: ctx.clinicId,
      doctorId: appt.doctorId ?? undefined,
      patientId: acting.patientId,
      appointmentId: appt.id,
    },
    type: "patient.arrived",
    payload: {
      appointmentId: appt.id,
      patientId: acting.patientId,
      patientName: appt.patient.fullName || undefined,
      doctorId: appt.doctorId ?? null,
      time,
    },
  };
  // Atomic claim: only the request that flips arrivedAt from null publishes,
  // so two simultaneous taps still yield exactly one desk toast.
  const claimed = await prisma.appointment.updateMany({
    where: { id: appt.id, arrivedAt: null },
    data: { arrivedAt: new Date() },
  });
  if (claimed.count === 0) return ok({ ok: true, already: true });
  await publishViaOutbox(prisma, envelope);

  return ok({ ok: true });
});
