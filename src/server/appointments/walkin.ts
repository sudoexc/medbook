/**
 * Walk-in queue insertion — the single path that drops a patient straight into
 * a doctor's LIVE queue with a paper ticket.
 *
 * Two surfaces call this: the public self-service kiosk
 * (`/api/c/[slug]/queue/walkin`, anonymous SYSTEM context) and the CRM front
 * desk (`/api/crm/appointments/walkin`, authenticated TENANT context). Both
 * must allocate the queue slot the same way, or the board / kiosk / patient
 * ticket drift — exactly the duplication Variant C (`queue-projection`) exists
 * to kill. So the allocation lives here, once.
 *
 * Distinct from `bookAppointment`: that kernel creates BOOKED/CONFIRMED rows on
 * a time slot and runs overlap conflict detection. A walk-in is order-based,
 * not slot-based — it stacks at the back of today's queue (`queueOrder`) with
 * no conflict check, and lands as WAITING immediately.
 *
 * The caller owns the tenant context (`runWithTenant`) and the audit row; this
 * helper only resolves the patient, allocates the slot under Serializable
 * isolation, creates the row, and emits the realtime envelopes.
 */
import { prisma } from "@/lib/prisma";
import { normalizePhone, phoneSearchVariants } from "@/lib/phone";
import { tashkentComponents } from "@/lib/booking-validation";
import { publishEventSafe } from "@/server/realtime/publish";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { allocatePatientNumber } from "@/server/services/patient-number";
import {
  allocateQueueOrder,
  runQueueTx,
} from "@/server/appointments/queue-order";
import { generateTicketCode } from "@/server/appointments/ticket-code";

/** Existing patient by id, or details to find-or-create by phone. */
export type WalkinPatientInput =
  | { id: string }
  | { fullName: string; phone: string; lang?: "RU" | "UZ" };

export type RegisterWalkinInput = {
  clinicId: string;
  doctorId: string;
  patient: WalkinPatientInput;
  /** Staff `User.id` for the CRM front desk; `null` for the anonymous kiosk. */
  createdById?: string | null;
  /** Visit length in minutes; defaults to 30. */
  durationMin?: number;
};

export type RegisterWalkinResult =
  | {
      ok: true;
      appointmentId: string;
      ticketCode: string;
      ticketNumber: string;
      queueOrder: number;
      patient: { id: string; fullName: string };
      doctor: {
        id: string;
        nameRu: string;
        nameUz: string;
        color: string | null;
      };
      cabinet: string | null;
    }
  | { ok: false; reason: "doctor_not_found" | "bad_phone" | "patient_not_found" };

export async function registerWalkin(
  input: RegisterWalkinInput,
): Promise<RegisterWalkinResult> {
  const doctor = await prisma.doctor.findFirst({
    where: { id: input.doctorId, clinicId: input.clinicId, isActive: true },
    select: {
      id: true,
      nameRu: true,
      nameUz: true,
      color: true,
      pricePerVisit: true,
      cabinetId: true,
      cabinet: { select: { number: true } },
    },
  });
  if (!doctor) return { ok: false, reason: "doctor_not_found" };

  // Resolve the patient: an explicit id (CRM picked an existing record) or a
  // find-or-create by phone (kiosk, or CRM "new patient" form).
  let patient: { id: string; fullName: string } | null;
  if ("id" in input.patient) {
    patient = await prisma.patient.findFirst({
      where: { id: input.patient.id, clinicId: input.clinicId },
      select: { id: true, fullName: true },
    });
    if (!patient) return { ok: false, reason: "patient_not_found" };
  } else {
    const phoneNorm = normalizePhone(input.patient.phone);
    if (!phoneNorm) return { ok: false, reason: "bad_phone" };

    const variants = phoneSearchVariants(input.patient.phone);
    patient = await prisma.patient.findFirst({
      where: { clinicId: input.clinicId, phone: { in: variants } },
      select: { id: true, fullName: true },
    });
    if (!patient) {
      const fullName = input.patient.fullName;
      const lang = input.patient.lang ?? "RU";
      patient = await prisma.$transaction(async (tx) => {
        const patientNumber = await allocatePatientNumber(input.clinicId, tx);
        return tx.patient.create({
          data: {
            clinicId: input.clinicId,
            patientNumber,
            fullName,
            phone: phoneNorm,
            phoneNormalized: phoneNorm,
            preferredLang: lang,
            source: "WALKIN",
          } as never,
          select: { id: true, fullName: true },
        });
      });
    }
  }

  // Place the visit "now" so it surfaces at the top of today's lists; the
  // receptionist can re-time it later. The display column must be Tashkent
  // wall-clock — prod runs UTC and `getHours()` would skew it −5h.
  const start = new Date();
  const durationMin = input.durationMin ?? 30;
  const end = new Date(start.getTime() + durationMin * 60_000);
  const time = tashkentComponents(start).time;

  // Human-readable ticket code (same generator as booked appointments) so the
  // paper slip carries a QR/lookup code into `/t/[code]`. Minted pre-tx so the
  // rare collision retry doesn't fight Serializable isolation.
  const ticketCode = await generateTicketCode();
  // Live lane is WALKIN by definition (two-lanes) — not caller-selectable.
  const channel = "WALKIN" as const;

  // Allocate the queue slot and create the row atomically under Serializable
  // isolation so two simultaneous walk-ins on the same doctor can't share a
  // queueOrder.
  const { queueOrder, created } = await runQueueTx(async (tx) => {
    const order = await allocateQueueOrder(tx, {
      clinicId: input.clinicId,
      doctorId: doctor.id,
      at: start,
    });
    const c = await tx.appointment.create({
      data: {
        clinicId: input.clinicId,
        patientId: patient.id,
        doctorId: doctor.id,
        cabinetId: doctor.cabinetId,
        date: start,
        time,
        durationMin,
        endDate: end,
        status: "WAITING",
        queueStatus: "WAITING",
        queueOrder: order,
        // Immutable ticket sequence, frozen at creation (see queue-projection).
        ticketSeq: order,
        // FIFO anchor of the live lane — a walk-in is served from the moment
        // it joined the queue, which is "now" (== `start`, the display instant).
        queuedAt: start,
        channel,
        ticketCode,
        createdById: input.createdById ?? null,
        priceBase: doctor.pricePerVisit ?? null,
        priceFinal: doctor.pricePerVisit ?? null,
      } as never,
      select: { id: true },
    });
    return { queueOrder: order, created: c };
  });

  publishEventSafe(input.clinicId, {
    type: "appointment.created",
    payload: {
      appointmentId: created.id,
      doctorId: doctor.id,
      patientId: patient.id,
      status: "WAITING",
    },
  });
  publishEventSafe(input.clinicId, {
    type: "queue.updated",
    payload: {
      appointmentId: created.id,
      doctorId: doctor.id,
      queueStatus: "WAITING",
    },
  });

  return {
    ok: true,
    appointmentId: created.id,
    ticketCode,
    // Non-null: `queueOrder` was just allocated above, so a ticket always
    // prints for a fresh walk-in (ticketNumberFor is null only for seq-less
    // bookings).
    ticketNumber: ticketNumberFor(doctor.id, queueOrder)!,
    queueOrder,
    patient: { id: patient.id, fullName: patient.fullName },
    doctor: {
      id: doctor.id,
      nameRu: doctor.nameRu,
      nameUz: doctor.nameUz,
      color: doctor.color,
    },
    cabinet: doctor.cabinet?.number ?? null,
  };
}
