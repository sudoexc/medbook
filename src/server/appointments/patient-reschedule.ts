/**
 * The patient moves his own booking from the Mini App (audit MA-16, MA-17).
 *
 * What the old in-route PATCH got wrong, and what this kernel does instead:
 *
 *   - Price. Every move wrote `priceFinal = priceBase`, the plain sum of the
 *     catalog prices: a free repeat visit (0 сум), a reception discount or a
 *     referral discount was wiped by moving the visit an hour, and a paid
 *     visit was repriced against the till. Now a move leaves the price
 *     columns alone, except that a visit filed under a case is repriced by
 *     the free-repeat engine (its «first vs repeat» answer depends on the
 *     date, same as a CRM move), which keeps a paid visit frozen. A change
 *     of services reprices through the same engine and is refused once money
 *     moved on the visit.
 *   - What may move. Only a booking that has not reached the clinic
 *     (`patientRescheduleRefusal`): live-queue rows, WAITING, SKIPPED and
 *     NO_SHOW used to travel to another day with their queue columns. The
 *     check is repeated inside the write, so a visit reception marks
 *     «Пришёл» in the meantime is not moved.
 *   - Where. A new doctor brings his own cabinet (the overlap check ran
 *     against the old doctor's room), must offer the visit's services, and
 *     a new start must be one the picker offers: on the doctor's grid, within
 *     the booking horizon and not in the past.
 *   - Reminders. A moved start cancels the reminders rendered for the old
 *     time and schedules new ones (`appointment.rescheduled`).
 *
 * Caller MUST already be inside `runWithTenant` and have resolved WHICH
 * patient acts (the owner or a linked relative, `resolveActivePatient`).
 */
import type { Appointment } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { tashkentComponents } from "@/lib/booking-validation";
import { patientRescheduleRefusal } from "@/lib/appointments/patient-reschedule";
import { previousDoctorField } from "@/lib/appointments/event-doctors";
import {
  isWithinBookingHorizon,
  MINIAPP_MAX_SERVICES_PER_BOOKING,
} from "@/lib/appointments/patient-booking";
import {
  computeEndDate,
  detectConflicts,
  isOfferedSlotStart,
} from "@/server/services/appointments";
import {
  recomputeAppointmentPrice,
  recomputeCaseAppointments,
} from "@/server/pricing/recompute-appointment-price";
import { isSlotOverlapViolation } from "@/server/appointments/overlap-violation";
import {
  loadDoctorMoveTerms,
  loadDoctorServiceTerms,
} from "@/server/doctors/service-terms";
import {
  durationAfterDoctorChange,
  linePricesForDoctor,
  servicesDurationWith,
  type EffectiveServiceTerms,
} from "@/lib/doctor-service-terms";
import { fireTrigger } from "@/server/notifications/triggers";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import type { Actor, EventEnvelopeInput } from "@/server/realtime/envelope";

export type PatientRescheduleInput = {
  clinicId: string;
  appointmentId: string;
  /** The patient the visit must belong to: the owner or his relative. */
  patientId: string;
  actor: Actor;
  startAt?: Date;
  doctorId?: string;
  serviceIds?: string[];
  now?: Date;
};

export type PatientRescheduleFailure = {
  ok: false;
  status: 400 | 404 | 409 | 422;
  reason: string;
  until?: string;
};

export type PatientRescheduleResult =
  | { ok: true; appointment: Appointment; moved: boolean }
  | PatientRescheduleFailure;

/** Payments that freeze the visit's service list: any money that moved. */
const MONEY_MOVED = { status: { not: "UNPAID" as const } };

/** The visit left the movable states between the read and the write. */
class RescheduleRaced extends Error {}

function fail(
  status: PatientRescheduleFailure["status"],
  reason: string,
  until?: string,
): PatientRescheduleFailure {
  return until ? { ok: false, status, reason, until } : { ok: false, status, reason };
}

export async function reschedulePatientAppointment(
  input: PatientRescheduleInput,
): Promise<PatientRescheduleResult> {
  const now = input.now ?? new Date();
  const before = await prisma.appointment.findFirst({
    where: {
      id: input.appointmentId,
      clinicId: input.clinicId,
      patientId: input.patientId,
    },
    include: {
      services: { select: { serviceId: true } },
      payments: { where: MONEY_MOVED, select: { id: true } },
    },
  });
  if (!before) return fail(404, "NotFound");

  const refusal = patientRescheduleRefusal(before);
  if (refusal) return fail(409, refusal);

  // Doctor. A new one is new work directed at him: he must belong to this
  // clinic and be active, and the visit takes his cabinet. Keeping the same
  // doctor is exempt, so a deactivated doctor's visits can still be moved.
  const doctorId = input.doctorId ?? before.doctorId;
  const doctorChanged = doctorId !== before.doctorId;
  let cabinetId = before.cabinetId;
  if (doctorChanged) {
    const target = await prisma.doctor.findFirst({
      where: { id: doctorId, clinicId: input.clinicId, isActive: true },
      select: { id: true, cabinetId: true, cabinet: { select: { isActive: true } } },
    });
    if (!target) return fail(404, "doctor_not_found");
    if (!target.cabinet?.isActive) return fail(422, "cabinet_inactive");
    cabinetId = target.cabinetId;
  }

  // Services. Absent or empty keeps the visit's own lines.
  const newServiceIds =
    input.serviceIds && input.serviceIds.length > 0
      ? Array.from(new Set(input.serviceIds))
      : null;
  if (newServiceIds && newServiceIds.length > MINIAPP_MAX_SERVICES_PER_BOOKING) {
    return fail(400, "too_many_services");
  }
  const currentServiceIds =
    before.services.length > 0
      ? before.services.map((s) => s.serviceId)
      : before.serviceId
        ? [before.serviceId]
        : [];
  const servicesChanged =
    newServiceIds !== null &&
    (newServiceIds.length !== currentServiceIds.length ||
      newServiceIds.some((id) => !currentServiceIds.includes(id)));
  if (servicesChanged && before.payments.length > 0) {
    // The till already took money against these lines; the desk changes them.
    return fail(409, "has_payment");
  }
  // Priced and sized as the visit's doctor charges (audit DR-02), the rule
  // booking and the CRM follow: new lines take his price and length.
  let durationMin = before.durationMin;
  let newLineTerms: Map<string, EffectiveServiceTerms> | null = null;
  if (servicesChanged && newServiceIds) {
    newLineTerms = await loadDoctorServiceTerms(prisma, {
      doctorId,
      serviceIds: newServiceIds,
      where: { clinicId: input.clinicId, isActive: true },
    });
    if (newLineTerms.size !== newServiceIds.length) return fail(404, "service_not_found");
    durationMin = servicesDurationWith(newServiceIds, newLineTerms) || 30;
  }
  // Only services this doctor offers (MA-08, MA-14): checked whenever the
  // pair changes, never for an untouched visit.
  const lineIds = servicesChanged && newServiceIds ? newServiceIds : currentServiceIds;
  if ((doctorChanged || servicesChanged) && lineIds.length > 0) {
    const linked = await prisma.serviceOnDoctor.count({
      where: { doctorId, serviceId: { in: lineIds } },
    });
    if (linked !== lineIds.length) return fail(404, "service_not_found");
  }

  // The same services with another doctor (DR-02, as a CRM move does): the
  // lines take his prices unless money moved on the visit, which freezes
  // them with the price, and a block sized by the leaving doctor's
  // durations takes his.
  let doctorLinePrices: { serviceId: string; priceSnap: number }[] = [];
  if (doctorChanged && !servicesChanged) {
    const terms = await loadDoctorMoveTerms(prisma, {
      appointmentId: before.id,
      fromDoctorId: before.doctorId,
      toDoctorId: doctorId,
    });
    if (before.payments.length === 0) {
      doctorLinePrices = linePricesForDoctor(terms.lines, terms.to);
    }
    durationMin = durationAfterDoctorChange({
      durationMin: before.durationMin,
      serviceIds: terms.serviceIds,
      from: terms.from,
      to: terms.to,
    });
  }

  const startAt = input.startAt ?? before.date;
  const endAt = computeEndDate(startAt, durationMin);
  const startMoved = startAt.getTime() !== before.date.getTime();
  if (!startMoved && !doctorChanged && !servicesChanged) {
    return { ok: true, appointment: before, moved: false };
  }
  if (startMoved && !isWithinBookingHorizon(startAt, now)) {
    return fail(400, "beyond_horizon");
  }
  // The slot as it will be (new start, new doctor's hours, new length)
  // must be one his picker offers.
  if (!(await isOfferedSlotStart({ doctorId, startAt, durationMin }))) {
    return fail(400, "off_grid");
  }

  const c = await detectConflicts({
    doctorId,
    cabinetId,
    startAt,
    endAt,
    excludeId: before.id,
    currentStartAt: before.date,
  });
  if (!c.ok) return fail(409, c.reason, c.until);

  // Display column in Tashkent wall clock: prod runs UTC.
  const time = tashkentComponents(startAt).time;
  const correlationId = newCorrelationId();

  let updated: Appointment | null;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // The movable-state check again, as part of the write itself.
      const claimed = await tx.appointment.updateMany({
        where: {
          id: before.id,
          status: { in: ["BOOKED", "CONFIRMED"] },
          queueStatus: { notIn: ["WAITING", "IN_PROGRESS", "SKIPPED"] },
          channel: { not: "WALKIN" },
          arrivedAt: null,
        },
        data: {
          doctorId,
          cabinetId,
          date: startAt,
          time,
          durationMin,
          endDate: endAt,
          ...(servicesChanged && newServiceIds ? { serviceId: newServiceIds[0] } : {}),
        },
      });
      if (claimed.count === 0) throw new RescheduleRaced();

      if (servicesChanged && newServiceIds) {
        await tx.appointmentService.deleteMany({ where: { appointmentId: before.id } });
        await tx.appointmentService.createMany({
          data: newServiceIds.map((sid) => ({
            clinicId: input.clinicId,
            appointmentId: before.id,
            serviceId: sid,
            priceSnap: newLineTerms?.get(sid)?.price ?? 0,
            quantity: 1,
          })),
        });
      }
      for (const line of doctorLinePrices) {
        await tx.appointmentService.updateMany({
          where: { appointmentId: before.id, serviceId: line.serviceId },
          data: { priceSnap: line.priceSnap },
        });
      }

      // Price: new lines are priced like a booking (lines minus the visit's
      // discounts). A move alone touches the price only for a visit in a
      // case, where the date decides «first vs repeat», or for one whose new
      // doctor charges other line prices (DR-02); the engine keeps a paid
      // visit frozen there. Any other move keeps every price column.
      if (servicesChanged) {
        await recomputeAppointmentPrice(tx, before.id, { servicesEdited: true });
      } else if (doctorLinePrices.length > 0 || (startMoved && before.medicalCaseId)) {
        await recomputeAppointmentPrice(tx, before.id);
      }
      if (before.medicalCaseId && (startMoved || servicesChanged)) {
        await recomputeCaseAppointments(tx, before.medicalCaseId);
      }

      const after = await tx.appointment.findUniqueOrThrow({ where: { id: before.id } });

      const baseEnvelope = {
        correlationId,
        actor: input.actor,
        surface: "MINIAPP" as const,
        tenantScope: {
          clinicId: input.clinicId,
          doctorId: after.doctorId,
          patientId: after.patientId,
          appointmentId: after.id,
        },
      };
      const updatedEnvelope: EventEnvelopeInput = {
        ...baseEnvelope,
        type: "appointment.updated",
        payload: {
          appointmentId: after.id,
          doctorId: after.doctorId,
          // A patient picking another doctor: the previous one's screens
          // drop events that name only the new doctor (audit G3-12).
          ...previousDoctorField(before.doctorId, after.doctorId),
          patientId: after.patientId,
          cabinetId: after.cabinetId,
          status: after.status,
          date: after.date.toISOString(),
          previousDate: before.date.toISOString(),
        },
      };
      const { eventId } = await publishViaOutbox(tx, updatedEnvelope);
      // The doctor's queue may shift on a date or doctor change.
      await publishViaOutbox(tx, {
        ...baseEnvelope,
        causedByEventId: eventId,
        type: "queue.updated",
        payload: {
          appointmentId: after.id,
          doctorId: after.doctorId,
          ...previousDoctorField(before.doctorId, after.doctorId),
          queueStatus: after.queueStatus,
        },
      });
      return after;
    });
  } catch (e) {
    if (e instanceof RescheduleRaced) {
      updated = null;
    } else if (isSlotOverlapViolation(e)) {
      // The EXCLUDE constraint is the last word: a booking took the slot
      // between detectConflicts and this write.
      return fail(409, "doctor_busy");
    } else {
      throw e;
    }
  }
  if (!updated) {
    const fresh = await prisma.appointment.findUnique({
      where: { id: before.id },
      select: { status: true, queueStatus: true, arrivedAt: true, channel: true },
    });
    return fail(409, (fresh && patientRescheduleRefusal(fresh)) ?? "not_reschedulable");
  }

  // A moved start retracts the reminders rendered for the old time and
  // tells the patient the new one; any other change only tops them up.
  fireTrigger({
    kind: startMoved ? "appointment.rescheduled" : "appointment.updated",
    appointmentId: updated.id,
  });
  return { ok: true, appointment: updated, moved: true };
}
