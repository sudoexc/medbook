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
import { normalizePhone } from "@/lib/phone";
import {
  tashkentComponents,
  tashkentDayBounds,
} from "@/lib/booking-validation";
import { publishEventSafe } from "@/server/realtime/publish";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { allocatePatientNumber } from "@/server/services/patient-number";
import {
  allocateQueueOrder,
  runQueueTx,
} from "@/server/appointments/queue-order";
import { generateTicketCode } from "@/server/appointments/ticket-code";
import {
  birthDateFromYear,
  parsePatientIdentity,
} from "@/lib/patients/parse-identity";
import type { IdentityProbe } from "@/lib/patients/identity-match";
import {
  contactPhoneStub,
  isUniqueViolation,
  releaseUnverifiedPhone,
  verifyPhoneInPerson,
} from "@/server/patient/phone-identity";
import {
  decidePhoneOwner,
  type PhoneOwnerAnswer,
  type PhoneOwnerSummary,
} from "@/server/patient/phone-owner";

/**
 * The caller's answer to «is this the person the number belongs to?»
 * (see `decidePhoneOwner`). Omitted, the typed name decides, and anything
 * uncertain comes back as `phone_owner_mismatch` for the caller to ask.
 */
export type { PhoneOwnerAnswer, PhoneOwnerSummary };

/** Existing patient by id, or details to find-or-create by phone. */
export type WalkinPatientInput =
  | { id: string }
  | {
      fullName: string;
      phone: string;
      lang?: "RU" | "UZ";
      phoneOwner?: PhoneOwnerAnswer;
    };

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
      /**
       * True when this call found the patient already waiting for the same
       * doctor today and returned that place instead of creating a second
       * one. Callers surface it as «уже в очереди», not as a new ticket.
       */
      duplicate: boolean;
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
  | { ok: false; reason: "doctor_not_found" | "bad_phone" | "patient_not_found" }
  | {
      ok: false;
      /**
       * The number belongs to a card whose name does not match what was
       * typed, or is only claimed by a Mini App card. Nothing was created;
       * the caller shows the card and asks.
       */
      reason: "phone_owner_mismatch";
      owner: PhoneOwnerSummary;
    };

type NewWalkinPatient = Extract<WalkinPatientInput, { phone: string }>;

type ResolvedByPhone =
  | { ok: true; patient: { id: string; fullName: string } }
  | { ok: false; reason: "bad_phone" }
  | { ok: false; reason: "phone_owner_mismatch"; owner: PhoneOwnerSummary };

/**
 * Find or create the card for a walk-in typed as name + phone (kiosk, the
 * front desk's and the doctor's «Новый пациент»).
 *
 * The number alone never decides (audit Q-03): the old path took whichever
 * card had the number and dropped the typed name, so a son registered with
 * his mother's phone was treated in HER record. `decidePhoneOwner` holds the
 * rules shared with the CRM «new patient» form; this function carries them
 * out:
 *   - an existing card is used as is, and a Mini App claim the person just
 *     confirmed becomes verified (her bookings and Telegram stay with it,
 *     instead of a second card taking the number and stranding them);
 *   - a question goes back to the caller as `phone_owner_mismatch`;
 *   - a new card either owns the number (any unverified claim on it is
 *     released first: the person is standing at the desk or the kiosk) or,
 *     for a relative on an owned number, keeps it as a contact phone.
 *
 * Creation runs outside the queue's serializable transaction, so two
 * simultaneous presses can both try to create the owner; the loser hits the
 * unique phone index and simply resolves again, finding the winner.
 */
async function resolvePatientByPhone(
  clinicId: string,
  typed: NewWalkinPatient,
): Promise<ResolvedByPhone> {
  const phoneNorm = normalizePhone(typed.phone);
  if (!phoneNorm) return { ok: false, reason: "bad_phone" };

  // The doctor types «Турматов О 1969» — surname, initial, birth year in
  // one field, because that is how he writes on paper. Lift the year out
  // here rather than at one call site, so a patient created from the
  // kiosk, the front desk or the doctor's own dialog is stored the same.
  const parsed = parsePatientIdentity(typed.fullName);
  const fullName = parsed.fullName || typed.fullName.trim();
  const probe: IdentityProbe = { fullName, birthYear: parsed.birthYear };

  for (let attempt = 0; ; attempt += 1) {
    const decision = await decidePhoneOwner(
      prisma,
      clinicId,
      phoneNorm,
      probe,
      typed.phoneOwner,
    );
    if (decision.kind === "ask") {
      return { ok: false, reason: "phone_owner_mismatch", owner: decision.owner };
    }
    if (decision.kind === "use") {
      const { card } = decision;
      if (decision.verifyClaim) {
        await verifyPhoneInPerson(prisma, clinicId, card.id, "walkin");
      }
      return { ok: true, patient: { id: card.id, fullName: card.fullName } };
    }

    // A second person on an owned number keeps it as a contact phone only.
    const { asContact } = decision;
    const birthDate =
      parsed.birthYear !== null ? birthDateFromYear(parsed.birthYear) : null;
    try {
      const created = await prisma.$transaction(async (tx) => {
        if (!asContact) {
          await releaseUnverifiedPhone(tx, clinicId, phoneNorm, "walkin_owner");
        }
        const patientNumber = await allocatePatientNumber(clinicId, tx);
        return tx.patient.create({
          data: {
            clinicId,
            patientNumber,
            fullName,
            phone: phoneNorm,
            phoneNormalized: asContact ? contactPhoneStub() : phoneNorm,
            // In person at the desk or kiosk: the number is theirs. A
            // contact sharer's number is someone else's, never identity.
            phoneVerifiedAt: asContact ? null : new Date(),
            preferredLang: typed.lang ?? "RU",
            ...(birthDate ? { birthDate } : {}),
            source: "WALKIN",
          } as never,
          select: { id: true, fullName: true },
        });
      });
      return { ok: true, patient: created };
    } catch (e) {
      if (attempt === 0 && isUniqueViolation(e)) continue;
      throw e;
    }
  }
}

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
      ticketPrefix: true,
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
    const resolved = await resolvePatientByPhone(input.clinicId, input.patient);
    if (!resolved.ok) return resolved;
    patient = resolved.patient;
  }

  // Place the visit "now" so it surfaces at the top of today's lists; the
  // receptionist can re-time it later. The display column must be Tashkent
  // wall-clock — prod runs UTC and `getHours()` would skew it −5h.
  const start = new Date();
  // Today in clinic time — the duplicate check must not reach yesterday's
  // queue (prod runs UTC, so a raw date comparison would skew by 5 hours).
  const { dayStart, dayEnd } = tashkentDayBounds(start);
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
  //
  // The same transaction also enforces "one live place per patient": the
  // clinic reported a doctor double-clicking «Добавить» and getting the same
  // person twice in the queue (C-001 and C-002, both Юсупова Лола). A client
  // guard alone cannot fix that — a retried request or a second tab produces
  // the same duplicate — so the rule lives here, inside the serializable
  // transaction that already owns queue ordering. A patient genuinely coming
  // back later in the day is unaffected: the earlier visit is no longer
  // WAITING by then.
  const { queueOrder, ticketSeq, issuedCode, created, duplicate } = await runQueueTx(async (tx) => {
    const alreadyQueued = await tx.appointment.findFirst({
      where: {
        clinicId: input.clinicId,
        doctorId: doctor.id,
        patientId: patient.id,
        queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
        date: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { queueOrder: "asc" },
      select: { id: true, queueOrder: true, ticketSeq: true, ticketCode: true },
    });
    if (alreadyQueued) {
      // Hand back the ticket the patient ALREADY holds. The code minted above
      // was never saved, so a kiosk that printed it would issue a slip whose
      // QR resolves to nothing.
      return {
        queueOrder: alreadyQueued.queueOrder ?? 0,
        ticketSeq: alreadyQueued.ticketSeq ?? alreadyQueued.queueOrder,
        issuedCode: alreadyQueued.ticketCode,
        created: { id: alreadyQueued.id },
        duplicate: true,
      };
    }

    const { queueOrder: order, ticketSeq } = await allocateQueueOrder(tx, {
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
        ticketSeq,
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
    return {
      queueOrder: order,
      ticketSeq,
      issuedCode: ticketCode,
      created: c,
      duplicate: false,
    };
  });

  // A duplicate press changed nothing, so it announces nothing: firing
  // appointment.created for a row that already existed would light up every
  // screen in the clinic for a no-op.
  if (!duplicate) {
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
  }

  return {
    ok: true,
    appointmentId: created.id,
    /** True when the patient was already in this doctor's live queue. */
    duplicate,
    ticketCode: issuedCode ?? ticketCode,
    // The printed number comes from ticketSeq, never queueOrder: the two part
    // ways once a cancelled ticket is skipped. Non-null for a fresh walk-in
    // (just allocated); a duplicate falls back to its order. Same function
    // and the same doctor letter as the board and the paper stub (Q-12), so
    // «уже в очереди: A-004» names the slip the patient actually holds.
    ticketNumber: ticketNumberFor(doctor, ticketSeq ?? queueOrder)!,
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
