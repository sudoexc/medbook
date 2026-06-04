/**
 * Single entry point for "book an appointment".
 *
 * Mini-app overhaul Phase M1 — lifts the booking kernel out of the CRM POST
 * (`/api/crm/appointments`) and mini-app POST (`/api/miniapp/appointments`) so
 * every surface that creates an appointment walks the same conflict / pricing
 * / outbox path. Mirrors the pattern set by `confirmAppointment` /
 * `cancelAppointment` from Phase B.
 *
 * Caller MUST already be inside `runWithTenant({ kind: 'TENANT', clinicId })`.
 *
 * Returns a discriminated union — the caller translates `ok: false` into a
 * 4xx response (`doctor_not_found` → 404, `*_busy` → 409, etc).
 *
 * Side-effects split between in-tx and post-tx:
 *
 *   In tx — committed atomically with the appointment row:
 *     • detectConflicts → fail-fast on overlap (Serializable isolation)
 *     • appointment.create
 *     • appointmentService.createMany (when `services[]` provided)
 *     • referralReward.update (when `applyReferralReward` matched a pending)
 *     • recomputeAppointmentPrice + recomputeCaseAppointments (free-repeat)
 *     • auditLog.create for APPOINTMENT_CONFIRMED (autoConfirm path)
 *     • auditLog.create for REFERRAL_REWARD_APPLIED
 *     • auditLog.create for appointment.free_repeat_applied
 *     • publishViaOutbox → appointment.created + queue.updated envelopes
 *
 *   Post tx — separate side-effects, do not block the booking:
 *     • fireTrigger("appointment.created") — notification scheduling
 *     • autoAttachCase (when `autoAttachCaseOptions` provided) — case auto-attach
 *
 * The `appointment.created` envelope is `auditable: true` so the outbox
 * pumper materialises the canonical AuditLog entry — callers do NOT need to
 * write a manual `appointment.create` audit row.
 */

import type { Appointment, ChannelType } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  applyTime,
  computeEndDate,
  detectConflicts,
} from "@/server/services/appointments";
import {
  recomputeAppointmentPrice,
  recomputeCaseAppointments,
} from "@/server/pricing/recompute-appointment-price";
import { fireTrigger } from "@/server/notifications/triggers";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type {
  Actor,
  EventEnvelopeInput,
  Surface,
} from "@/server/realtime/envelope";
import {
  findApplicableReferralReward,
  markReferralRewardApplied,
  type ReferralRewardSnapshot,
} from "@/server/referral/apply-reward";
import {
  autoAttachCase,
  type AutoAttachCaseInput,
  type CaseAttachOutcome,
} from "@/server/cases/attach";

// ─────────────────────────────────────────────────────────────────────────────
// Input + result types

export type BookServiceLine = {
  serviceId: string;
  quantity?: number;
  /** UZS minor units override; defaults to the catalog `priceBase`. */
  priceOverride?: number;
};

export type BookInput = {
  // Tenant + subject
  clinicId: string;
  patientId: string;
  doctorId: string;

  // When (CRM passes `date + time`; mini-app passes a precomputed `startAt`).
  startAt: Date;
  /** Optional HH:MM string for the row's display column (CRM preserves it). */
  time?: string | null;

  // Service catalog
  /** Primary service id stored on `Appointment.serviceId`. */
  serviceId?: string | null;
  /** Line items written to `AppointmentService`. */
  services?: BookServiceLine[];
  /** Override the duration; otherwise computed from `services[].durationMin` or 30. */
  durationMin?: number;

  // Pricing overrides
  discountPct?: number;
  discountAmount?: number;
  /** When set and pricing isn't recomputed via case, this lands on the row. */
  priceFinal?: number | null;

  // Case attach (at-create — CRM passes the id; mini-app picks via post-tx auto-attach helper)
  medicalCaseId?: string | null;

  // Mini-app extras
  /** When true, find + apply the patient's oldest PENDING referral reward. */
  applyReferralReward?: boolean;

  // CRM extras
  channel: ChannelType;
  notes?: string | null;
  comments?: string | null;
  leadId?: string | null;
  /** Staff `User.id` who created the row (CRM). `null` for mini-app. */
  createdById?: string | null;

  /** When true, status starts as CONFIRMED + confirmedAt/Via stamped. CRM-only. */
  autoConfirm?: boolean;

  // Identity for outbox + audit
  actor: Actor;
  surface: Surface;
  correlationId?: string;

  /** When set, runs `autoAttachCase` after the booking commits (mini-app path). */
  autoAttachCaseOptions?: Omit<AutoAttachCaseInput, "appointmentId">;
};

export type BookedAppointmentProjection = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  cabinetId: string | null;
  status: Appointment["status"];
  queueStatus: Appointment["queueStatus"];
  date: Date;
  endDate: Date;
  time: string | null;
  durationMin: number;
  priceBase: number | null;
  priceService: number | null;
  priceFinal: number | null;
  discountPct: number;
  discountAmount: number;
};

export type BookResult =
  | {
      ok: true;
      appointment: BookedAppointmentProjection;
      eventId: string;
      autoConfirmed: boolean;
      recomputed: {
        reason: string;
        daysFromFirst: number | null;
        savedAmount: number;
      } | null;
      referralReward: ReferralRewardSnapshot | null;
      caseAttach: CaseAttachOutcome | null;
    }
  | {
      ok: false;
      reason:
        | "doctor_not_found"
        | "doctor_inactive"
        | "cabinet_inactive"
        | "service_not_found"
        | "doctor_busy"
        | "cabinet_busy"
        | "doctor_time_off"
        | "outside_schedule"
        | "in_past"
        | "bad_start_at";
      until?: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Implementation

export async function bookAppointment(input: BookInput): Promise<BookResult> {
  // Re-derive the canonical start with `applyTime` when a separate `time` is
  // provided (CRM passes `date + "HH:MM"`). Mini-app already hands us a
  // precomputed `startAt` and skips `time`.
  const startAt = input.time
    ? applyTime(input.startAt, input.time)
    : input.startAt;
  if (Number.isNaN(startAt.getTime())) return { ok: false, reason: "bad_start_at" };

  // Doctor + cabinet existence + active checks. The cabinet binding is
  // doctor-derived (Phase 11 enforced 1:1) — callers no longer choose.
  const doctor = await prisma.doctor.findUnique({
    where: { id: input.doctorId },
    select: {
      id: true,
      clinicId: true,
      cabinetId: true,
      isActive: true,
      cabinet: { select: { isActive: true } },
    },
  });
  if (!doctor || doctor.clinicId !== input.clinicId) {
    return { ok: false, reason: "doctor_not_found" };
  }
  if (!doctor.isActive) return { ok: false, reason: "doctor_inactive" };
  if (!doctor.cabinet?.isActive) return { ok: false, reason: "cabinet_inactive" };
  const cabinetId = doctor.cabinetId;

  // Service catalog — used for duration + base price snapshot.
  const serviceLines = input.services ?? [];
  const allServiceIds = new Set<string>();
  if (input.serviceId) allServiceIds.add(input.serviceId);
  for (const s of serviceLines) allServiceIds.add(s.serviceId);

  let priceBase: number | null = null;
  let priceService: number | null = null;
  let derivedDurationMin = 0;
  if (allServiceIds.size > 0) {
    const services = await prisma.service.findMany({
      where: {
        id: { in: Array.from(allServiceIds) },
        clinicId: input.clinicId,
        isActive: true,
      },
      select: { id: true, priceBase: true, durationMin: true },
    });
    if (services.length !== allServiceIds.size) {
      return { ok: false, reason: "service_not_found" };
    }
    const priceMap = new Map(services.map((s) => [s.id, s.priceBase]));
    const durMap = new Map(services.map((s) => [s.id, s.durationMin]));
    // Base price: sum of catalog `priceBase` for every referenced service.
    priceBase = Array.from(allServiceIds).reduce(
      (a, sid) => a + (priceMap.get(sid) ?? 0),
      0,
    );
    if (input.serviceId) {
      priceService = priceMap.get(input.serviceId) ?? null;
    }
    derivedDurationMin = Array.from(allServiceIds).reduce(
      (a, sid) => a + (durMap.get(sid) ?? 0),
      0,
    );
  }

  const durationMin = input.durationMin ?? (derivedDurationMin || 30);
  const endAt = computeEndDate(startAt, durationMin);
  const correlationId = input.correlationId ?? newCorrelationId();

  // Referral reward look-up runs OUTSIDE the tx but the APPLIED stamp is
  // written INSIDE the tx so concurrent bookings cannot double-apply (the
  // Serializable isolation level surfaces the conflict as a P2034 retry).
  let referralReward: ReferralRewardSnapshot | null = null;
  if (input.applyReferralReward && priceBase !== null && priceBase > 0) {
    referralReward = await findApplicableReferralReward(prisma, {
      clinicId: input.clinicId,
      patientId: input.patientId,
      priceBase,
    });
  }

  // Effective discount = caller override OR referral snapshot. When both,
  // caller wins (CRM has full control; mini-app does not pass discount).
  const discountPct = input.discountPct ?? referralReward?.discountPct ?? 0;
  const discountAmount =
    input.discountAmount ?? referralReward?.discountAmount ?? 0;

  // priceFinal precedence:
  //   1. caller explicit (CRM with priceFinal override)
  //   2. base - discount (when we have a base)
  //   3. null (free-form / cash-only)
  const priceFinal =
    input.priceFinal !== undefined
      ? input.priceFinal
      : priceBase !== null
        ? Math.max(
            0,
            priceBase -
              discountAmount -
              Math.round((discountPct * priceBase) / 100),
          )
        : null;

  const time =
    input.time ??
    `${String(startAt.getHours()).padStart(2, "0")}:${String(
      startAt.getMinutes(),
    ).padStart(2, "0")}`;

  const autoConfirm = input.autoConfirm === true;
  const now = new Date();

  type RecomputedSnapshot = {
    reason: string;
    daysFromFirst: number | null;
    savedAmount: number;
  };
  let txResult:
    | {
        kind: "ok";
        appt: BookedAppointmentProjection;
        eventId: string;
        recomputed: RecomputedSnapshot | null;
      }
    | { kind: "conflict"; reason: string; until?: string };

  try {
    txResult = await prisma.$transaction(
      async (tx) => {
        const c = await detectConflicts(
          { doctorId: input.doctorId, cabinetId, startAt, endAt },
          tx,
        );
        if (!c.ok) {
          return { kind: "conflict" as const, reason: c.reason, until: c.until };
        }

        const created = await tx.appointment.create({
          data: {
            clinicId: input.clinicId,
            patientId: input.patientId,
            doctorId: input.doctorId,
            cabinetId,
            serviceId: input.serviceId ?? null,
            medicalCaseId: input.medicalCaseId ?? null,
            date: startAt,
            time,
            durationMin,
            endDate: endAt,
            status: autoConfirm ? "CONFIRMED" : "BOOKED",
            queueStatus: autoConfirm ? "CONFIRMED" : "BOOKED",
            channel: input.channel,
            leadId: input.leadId ?? null,
            priceService,
            priceBase,
            discountPct,
            discountAmount,
            priceFinal,
            createdById: input.createdById ?? null,
            comments: input.comments ?? null,
            notes: input.notes ?? null,
            ...(autoConfirm
              ? {
                  confirmedAt: now,
                  confirmedBy: input.createdById ?? null,
                  confirmedVia: "BOOKING_AUTO" as const,
                }
              : {}),
          },
        });

        if (serviceLines.length > 0) {
          const priceMap = new Map<string, number>();
          const svcRows = await tx.service.findMany({
            where: { id: { in: serviceLines.map((s) => s.serviceId) } },
            select: { id: true, priceBase: true },
          });
          for (const s of svcRows) priceMap.set(s.id, s.priceBase);
          await tx.appointmentService.createMany({
            data: serviceLines.map((s) => ({
              clinicId: input.clinicId,
              appointmentId: created.id,
              serviceId: s.serviceId,
              priceSnap: s.priceOverride ?? priceMap.get(s.serviceId) ?? 0,
              quantity: s.quantity ?? 1,
            })),
          });
        }

        // Mark referral reward APPLIED — same tx, so a concurrent booking
        // racing for the same reward loses on the Serializable retry.
        if (referralReward) {
          await markReferralRewardApplied(tx, {
            rewardId: referralReward.rewardId,
            appointmentId: created.id,
          });
        }

        // Free-repeat pricing engine. Runs inside the same tx so a follow-up
        // visit attached to a case at create time prices to 0 atomically. We
        // reprice the whole case because a backdated insert can flip the
        // chronological-first answer for an existing sibling.
        let recomputedResult: {
          reason: string;
          daysFromFirst: number | null;
          savedAmount: number;
        } | null = null;
        if (input.medicalCaseId) {
          const rec = await recomputeAppointmentPrice(tx, created.id);
          recomputedResult = {
            reason: rec.reason,
            daysFromFirst: rec.daysFromFirst,
            savedAmount: rec.savedAmount,
          };
          await recomputeCaseAppointments(tx, input.medicalCaseId);
        }

        // Manual audit rows that DON'T come from the outbox pumper:
        //   • `appointment.created` is auditable → pumper writes that one.
        //   • Auto-confirm needs a separate APPOINTMENT_CONFIRMED row so the
        //     confirmation analytics see all five confirm paths uniformly.
        //   • Referral apply + free-repeat are domain side-effects with their
        //     own audit actions.

        if (autoConfirm) {
          await tx.auditLog.create({
            data: {
              clinicId: input.clinicId,
              actorId: input.createdById ?? null,
              actorRole: input.createdById ? null : input.actor.role,
              actorLabel: input.createdById ? null : input.actor.label,
              action: AUDIT_ACTION.APPOINTMENT_CONFIRMED,
              entityType: "Appointment",
              entityId: created.id,
              meta: {
                via: "BOOKING_AUTO",
                statusBefore: "BOOKED",
                statusAfter: "CONFIRMED",
                statusFlipped: true,
                channel: input.channel,
                correlationId,
              },
              ip: null,
              userAgent: null,
              surface: input.surface,
              correlationId,
            },
          });
        }

        if (referralReward) {
          await tx.auditLog.create({
            data: {
              clinicId: input.clinicId,
              actorId: input.createdById ?? null,
              actorRole: input.createdById ? null : input.actor.role,
              actorLabel: input.createdById ? null : input.actor.label,
              action: AUDIT_ACTION.REFERRAL_REWARD_APPLIED,
              entityType: "ReferralReward",
              entityId: referralReward.rewardId,
              meta: {
                appointmentId: created.id,
                patientId: input.patientId,
                rewardPercent: referralReward.discountPct,
                discountAmount: referralReward.discountAmount,
                priceBase,
                priceFinal: created.priceFinal,
                correlationId,
              },
              ip: null,
              userAgent: null,
              surface: input.surface,
              correlationId,
            },
          });
        }

        if (recomputedResult?.reason === "free_repeat") {
          await tx.auditLog.create({
            data: {
              clinicId: input.clinicId,
              actorId: input.createdById ?? null,
              actorRole: input.createdById ? null : input.actor.role,
              actorLabel: input.createdById ? null : input.actor.label,
              action: "appointment.free_repeat_applied",
              entityType: "Appointment",
              entityId: created.id,
              meta: {
                caseId: input.medicalCaseId,
                daysFromFirst: recomputedResult.daysFromFirst,
                savedAmount: recomputedResult.savedAmount,
                correlationId,
              },
              ip: null,
              userAgent: null,
              surface: input.surface,
              correlationId,
            },
          });
        }

        // Cross-surface sync — emit `appointment.created` envelope; downstream
        // CRM/cabinet/mini-app SSE subscribers fan out from the outbox.
        const baseEnvelope = {
          correlationId,
          actor: input.actor,
          surface: input.surface,
          tenantScope: {
            clinicId: input.clinicId,
            doctorId: created.doctorId,
            patientId: created.patientId,
            appointmentId: created.id,
          },
        } as const;
        const createdEnvelope: EventEnvelopeInput = {
          ...baseEnvelope,
          type: "appointment.created",
          payload: {
            appointmentId: created.id,
            doctorId: created.doctorId,
            patientId: created.patientId,
            cabinetId: created.cabinetId,
            status: created.status,
            date: created.date.toISOString(),
            channel: input.channel,
            autoConfirmed: autoConfirm,
          },
        };
        const { eventId } = await publishViaOutbox(tx, createdEnvelope);

        const queueEnvelope: EventEnvelopeInput = {
          ...baseEnvelope,
          causedByEventId: eventId,
          type: "queue.updated",
          payload: {
            appointmentId: created.id,
            doctorId: created.doctorId,
            queueStatus: created.queueStatus,
          },
        };
        await publishViaOutbox(tx, queueEnvelope);

        const projection: BookedAppointmentProjection = {
          id: created.id,
          clinicId: created.clinicId,
          patientId: created.patientId,
          doctorId: created.doctorId,
          cabinetId: created.cabinetId,
          status: created.status,
          queueStatus: created.queueStatus,
          date: created.date,
          endDate: created.endDate,
          time: created.time,
          durationMin: created.durationMin,
          priceBase: created.priceBase,
          priceService: created.priceService,
          priceFinal: created.priceFinal,
          discountPct: created.discountPct,
          discountAmount: created.discountAmount,
        };

        return {
          kind: "ok" as const,
          appt: projection,
          eventId,
          recomputed: recomputedResult,
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e: unknown) {
    // Postgres serialization / write conflict surfaces in three shapes; all
    // mean "lost the race". Match the CRM handler's conflict detection.
    const errLike = e as {
      code?: string;
      originalCode?: string;
      kind?: string;
      name?: string;
      message?: string;
    } | null;
    const msg = errLike?.message ?? "";
    const isAdapterErr = errLike?.name === "DriverAdapterError";
    const msgIndicatesConflict =
      msg.includes("exclusion constraint") ||
      msg.includes("Appointment_doctor_no_overlap") ||
      msg.includes("Appointment_cabinet_no_overlap") ||
      msg.includes("write conflict or a deadlock") ||
      msg.includes("could not serialize access");
    const isWriteConflict =
      errLike?.code === "P2034" ||
      errLike?.code === "40001" ||
      errLike?.code === "23P01" ||
      errLike?.originalCode === "40001" ||
      errLike?.originalCode === "23P01" ||
      errLike?.kind === "TransactionWriteConflict" ||
      (isAdapterErr && msgIndicatesConflict) ||
      msgIndicatesConflict;
    if (isWriteConflict) {
      const c = await detectConflicts({
        doctorId: input.doctorId,
        cabinetId,
        startAt,
        endAt,
      });
      if (!c.ok) {
        // detectConflicts returns "in_past" | "doctor_busy" | "cabinet_busy" |
        // "doctor_time_off" | "outside_schedule" — all of which are in the
        // BookResult union. Cast preserves the runtime value (was previously
        // narrowed to doctor_busy|cabinet_busy, which dropped the other three
        // and made the route handler's switch miss → 500).
        return {
          ok: false,
          reason: c.reason as
            | "doctor_busy"
            | "cabinet_busy"
            | "doctor_time_off"
            | "outside_schedule"
            | "in_past",
          until: c.until,
        };
      }
      return { ok: false, reason: "doctor_busy" };
    }
    console.error("[bookAppointment] uncaught error shape:", {
      name: errLike?.name,
      code: errLike?.code,
      originalCode: errLike?.originalCode,
      kind: errLike?.kind,
      message: errLike?.message?.slice(0, 200),
    });
    throw e;
  }

  if (txResult.kind === "conflict") {
    return {
      ok: false,
      reason: txResult.reason as
        | "doctor_busy"
        | "cabinet_busy"
        | "doctor_time_off"
        | "outside_schedule"
        | "in_past",
      until: txResult.until,
    };
  }

  // Post-tx side-effects — must NOT block the booking. If either throws the
  // booking is still committed; we surface the appointment to the caller and
  // let downstream reconcile.

  // Notification scheduling (immediate + 24h/2h reminders).
  fireTrigger({ kind: "appointment.created", appointmentId: txResult.appt.id });

  // Mini-app surface uses post-tx auto-attach (0/1/2+ open cases logic). CRM
  // omits this and either pre-attaches via `medicalCaseId` or leaves the
  // appointment case-less for the receptionist to attach later.
  let caseAttach: CaseAttachOutcome | null = null;
  if (input.autoAttachCaseOptions) {
    caseAttach = await autoAttachCase({
      ...input.autoAttachCaseOptions,
      appointmentId: txResult.appt.id,
    });
  }

  return {
    ok: true,
    appointment: txResult.appt,
    eventId: txResult.eventId,
    autoConfirmed: autoConfirm,
    recomputed: txResult.recomputed,
    referralReward,
    caseAttach,
  };
}
